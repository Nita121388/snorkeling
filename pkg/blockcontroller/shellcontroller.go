// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/blocklogger"
	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/pslog"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/util/envutil"
	"github.com/wavetermdev/waveterm/pkg/util/fileutil"
	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/utilds"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshrpc/wshclient"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wslconn"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	ConnType_Local = "local"
	ConnType_Wsl   = "wsl"
	ConnType_Ssh   = "ssh"
)

const (
	LocalConnVariant_GitBash = "gitbash"
)

const (
	MetaKey_AgentAutoResume = "agent:autoresume"
	MetaKey_AgentProvider   = "agent:provider"
	MetaKey_AgentSessionId  = "agent:sessionid"
)

const (
	AgentProviderCodex    = "codex"
	AgentProviderClaude   = "claude"
	AgentProviderOpenCode = "opencode"
	AgentProviderPi       = "pi"
)

type AgentRunInfo struct {
	Provider               string
	SessionId              string
	CaptureCodexSessionId  bool
	CodexSessionLookupHome string
	CodexSessionLookupRoot string
	CodexSessionLookupCwd  string
	CodexSessionStartedAt  time.Time
}

type codexSessionMetaLine struct {
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Payload   struct {
		Id        string `json:"id"`
		Cwd       string `json:"cwd"`
		Timestamp string `json:"timestamp"`
	} `json:"payload"`
}

type codexSessionCandidate struct {
	SessionId string
	Cwd       string
	Timestamp time.Time
	Path      string
}

const (
	codexSessionCaptureSettleDuration = 1200 * time.Millisecond
	codexSessionCaptureQuickAttempts  = 30
	codexSessionCaptureMaxAttempts    = 900
	codexSessionMetaScanLines         = 50
)

const ManualCodexSessionCaptureAttempts = 120

const (
	// claudeSessionCaptureMaxAttempts + claudeSessionCapturePollInterval cap the
	// async retry loop for persistAgentSessionId on the claude main path. claude id
	// is minted by the backend (resolveAgentCmdAndArgs:919) and pushed into claude
	// args unconditionally; the only failure mode is persistAgentSessionId's 2s ctx
	// losing a race with sqlite busy_timeout under concurrent writes. retry must
	// reuse the SAME sessionId so block meta stays aligned with the running claude
	// process's conversation history.
	claudeSessionCaptureMaxAttempts  = 30
	claudeSessionCapturePollInterval = 400 * time.Millisecond

	// claudeManualCaptureMaxAttempts / PollInterval for the SetMetaCommand rider
	// path (stale block restart case). mirrors codex manual rider timing.
	claudeManualCaptureMaxAttempts  = 30
	claudeManualCapturePollInterval = 400 * time.Millisecond
)

var codexOptionValueFlags = map[string]bool{
	"-a":                      true,
	"--add-dir":               true,
	"--ask-for-approval":      true,
	"-c":                      true,
	"--cd":                    true,
	"--config":                true,
	"--disable":               true,
	"--enable":                true,
	"-i":                      true,
	"--image":                 true,
	"--local-provider":        true,
	"-m":                      true,
	"--model":                 true,
	"-p":                      true,
	"--profile":               true,
	"--profile-v2":            true,
	"--remote":                true,
	"--remote-auth-token-env": true,
	"-s":                      true,
	"--sandbox":               true,
}

var codexOptionOnlyFlags = map[string]bool{
	"--all": true,
	"--dangerously-bypass-approvals-and-sandbox": true,
	"--dangerously-bypass-hook-trust":            true,
	"-h":                                         true,
	"--help":                                     true,
	"--include-non-interactive":                  true,
	"--last":                                     true,
	"--no-alt-screen":                            true,
	"--oss":                                      true,
	"--search":                                   true,
	"--strict-config":                            true,
	"-V":                                         true,
	"--version":                                  true,
}

type ShellController struct {
	Lock *sync.Mutex

	// shared fields
	ControllerType      string
	TabId               string
	BlockId             string
	ConnName            string
	BlockDef            *waveobj.BlockDef
	RunLock             *atomic.Bool
	ProcStatus          string
	ProcExitCode        int
	VersionTs           utilds.VersionTs
	KeepAgentMetaOnExit bool

	// for shell/cmd
	ShellProc    *shellexec.ShellProc
	ShellInputCh chan *BlockInputUnion
}

// Constructor that returns the Controller interface
func MakeShellController(tabId string, blockId string, controllerType string, connName string) Controller {
	return &ShellController{
		Lock:           &sync.Mutex{},
		ControllerType: controllerType,
		TabId:          tabId,
		BlockId:        blockId,
		ConnName:       connName,
		ProcStatus:     Status_Init,
		RunLock:        &atomic.Bool{},
	}
}

// Implement Controller interface methods

func (sc *ShellController) Start(ctx context.Context, blockMeta waveobj.MetaMapType, rtOpts *waveobj.RuntimeOpts, force bool) error {
	// Get the block data
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, sc.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}

	// Use the existing run method which handles all the start logic
	go sc.run(ctx, blockData, blockData.Meta, rtOpts, force)
	return nil
}

func (sc *ShellController) Stop(graceful bool, newStatus string, destroy bool) {
	sc.Lock.Lock()
	defer sc.Lock.Unlock()

	if sc.ShellProc == nil || sc.ProcStatus == Status_Done || sc.ProcStatus == Status_Init {
		if newStatus != sc.ProcStatus {
			sc.ProcStatus = newStatus
			sc.sendUpdate_nolock()
		}
		return
	}
	if !destroy {
		sc.KeepAgentMetaOnExit = true
	}

	sc.ShellProc.Close()
	if graceful {
		doneCh := sc.ShellProc.DoneCh
		sc.Lock.Unlock() // Unlock before waiting
		<-doneCh
		sc.Lock.Lock() // Re-lock after waiting
	}

	// Update status
	sc.ProcStatus = newStatus
	sc.sendUpdate_nolock()
}

func (sc *ShellController) getRuntimeStatus_nolock() BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	rtn.Version = sc.VersionTs.GetVersionTs()
	rtn.BlockId = sc.BlockId
	rtn.ShellProcStatus = sc.ProcStatus
	rtn.ShellProcConnName = sc.ConnName
	rtn.ShellProcExitCode = sc.ProcExitCode
	return rtn
}

func (sc *ShellController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	sc.WithLock(func() {
		rtn = sc.getRuntimeStatus_nolock()
	})
	return &rtn
}

func (sc *ShellController) GetConnName() string {
	return sc.ConnName
}

func (sc *ShellController) SendInput(inputUnion *BlockInputUnion) error {
	var shellInputCh chan *BlockInputUnion
	sc.WithLock(func() {
		shellInputCh = sc.ShellInputCh
	})
	if shellInputCh == nil {
		return fmt.Errorf("no shell input chan")
	}
	shellInputCh <- inputUnion
	return nil
}

func (sc *ShellController) WithLock(f func()) {
	sc.Lock.Lock()
	defer sc.Lock.Unlock()
	f()
}

type RunShellOpts struct {
	TermSize waveobj.TermSize `json:"termsize,omitempty"`
}

// only call when holding the lock
func (sc *ShellController) sendUpdate_nolock() {
	rtStatus := sc.getRuntimeStatus_nolock()
	log.Printf("sending blockcontroller update %#v\n", rtStatus)
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_ControllerStatus,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Tab, sc.TabId).String(),
			waveobj.MakeORef(waveobj.OType_Block, sc.BlockId).String(),
		},
		Data: rtStatus,
	})
}

func (sc *ShellController) UpdateControllerAndSendUpdate(updateFn func() bool) {
	var sendUpdate bool
	sc.WithLock(func() {
		sendUpdate = updateFn()
	})
	if sendUpdate {
		rtStatus := sc.GetRuntimeStatus()
		log.Printf("sending blockcontroller update %#v\n", rtStatus)
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_ControllerStatus,
			Scopes: []string{
				waveobj.MakeORef(waveobj.OType_Tab, sc.TabId).String(),
				waveobj.MakeORef(waveobj.OType_Block, sc.BlockId).String(),
			},
			Data: rtStatus,
		})
	}
}

func (sc *ShellController) resetTerminalState(logCtx context.Context) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	wfile, statErr := filestore.WFS.Stat(ctx, sc.BlockId, wavebase.BlockFile_Term)
	if statErr == fs.ErrNotExist {
		return
	}
	if statErr != nil {
		log.Printf("error statting term file: %v\n", statErr)
		return
	}
	if wfile.Size == 0 {
		return
	}
	blocklogger.Debugf(logCtx, "[conndebug] resetTerminalState: resetting terminal state\n")
	resetSeq := shellutil.GetTerminalResetSeq()
	resetSeq += "\r\n"
	err := HandleAppendBlockFile(sc.BlockId, wavebase.BlockFile_Term, []byte(resetSeq))
	if err != nil {
		log.Printf("error appending to blockfile (terminal reset): %v\n", err)
	}
}

func (sc *ShellController) writeMutedMessageToTerminal(msg string) {
	if sc.BlockId == "" {
		return
	}
	fullMsg := "\x1b[90m" + msg + "\x1b[0m\r\n"
	err := HandleAppendBlockFile(sc.BlockId, wavebase.BlockFile_Term, []byte(fullMsg))
	if err != nil {
		log.Printf("error writing muted message to terminal (blockid=%s): %v", sc.BlockId, err)
	}
}

// [All the other existing private methods remain exactly the same - I'm not including them all here for brevity, but they would all be copied over with sc. replacing bc. throughout]

func (sc *ShellController) DoRunShellCommand(logCtx context.Context, rc *RunShellOpts, blockMeta waveobj.MetaMapType) error {
	blocklogger.Debugf(logCtx, "[conndebug] DoRunShellCommand\n")
	shellProc, agentRunInfo, err := sc.setupAndStartShellProcess(logCtx, rc, blockMeta)
	if err != nil {
		return err
	}
	if shellProc == nil {
		return nil
	}
	return sc.manageRunningShellProcess(shellProc, rc, blockMeta, agentRunInfo)
}

// [Continue with all other methods, replacing bc with sc throughout...]

func (sc *ShellController) LockRunLock() bool {
	rtn := sc.RunLock.CompareAndSwap(false, true)
	if rtn {
		log.Printf("block %q run() lock\n", sc.BlockId)
	}
	return rtn
}

func (sc *ShellController) UnlockRunLock() {
	sc.RunLock.Store(false)
	log.Printf("block %q run() unlock\n", sc.BlockId)
}

func (sc *ShellController) run(logCtx context.Context, bdata *waveobj.Block, blockMeta map[string]any, rtOpts *waveobj.RuntimeOpts, force bool) {
	blocklogger.Debugf(logCtx, "[conndebug] ShellController.run() %q\n", sc.BlockId)
	runningShellCommand := false
	ok := sc.LockRunLock()
	if !ok {
		log.Printf("block %q is already executing run()\n", sc.BlockId)
		return
	}
	defer func() {
		if !runningShellCommand {
			sc.UnlockRunLock()
		}
	}()
	curStatus := sc.GetRuntimeStatus()
	controllerName := bdata.Meta.GetString(waveobj.MetaKey_Controller, "")
	if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
		log.Printf("unknown controller %q\n", controllerName)
		return
	}
	runOnce := getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdRunOnce, false)
	runOnStart := getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdRunOnStart, true)
	if ((runOnStart || runOnce) && curStatus.ShellProcStatus == Status_Init) || force {
		if getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdClearOnStart, false) {
			err := HandleTruncateBlockFile(sc.BlockId)
			if err != nil {
				log.Printf("error truncating term blockfile: %v\n", err)
			}
		}
		if runOnce {
			ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancelFn()
			metaUpdate := map[string]any{
				waveobj.MetaKey_CmdRunOnce:    false,
				waveobj.MetaKey_CmdRunOnStart: false,
			}
			err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, sc.BlockId), metaUpdate, false)
			if err != nil {
				log.Printf("error updating block meta (in blockcontroller.run): %v\n", err)
				return
			}
		}
		runningShellCommand = true
		go func() {
			defer func() {
				panichandler.PanicHandler("blockcontroller:run-shell-command", recover())
			}()
			defer sc.UnlockRunLock()
			var termSize waveobj.TermSize
			if rtOpts != nil {
				termSize = rtOpts.TermSize
			} else {
				termSize = getTermSize(bdata)
			}
			err := sc.DoRunShellCommand(logCtx, &RunShellOpts{TermSize: termSize}, bdata.Meta)
			if err != nil {
				debugLog(logCtx, "error running shell: %v\n", err)
			}
		}()
	}
}

// [Include all the remaining private methods with bc replaced by sc]

type ConnUnion struct {
	ConnName   string
	ConnType   string
	SshConn    *conncontroller.SSHConn
	WslConn    *wslconn.WslConn
	WshEnabled bool
	ShellPath  string
	ShellOpts  []string
	ShellType  string
	HomeDir    string
}

func (bc *ShellController) getConnUnion(logCtx context.Context, remoteName string, blockMeta waveobj.MetaMapType) (ConnUnion, error) {
	rtn := ConnUnion{ConnName: remoteName}
	wshEnabled := !blockMeta.GetBool(waveobj.MetaKey_CmdNoWsh, false)
	if strings.HasPrefix(remoteName, "wsl://") {
		wslName := strings.TrimPrefix(remoteName, "wsl://")
		wslConn := wslconn.GetWslConn(wslName)
		if wslConn == nil {
			return ConnUnion{}, fmt.Errorf("wsl connection not found: %s", remoteName)
		}
		connStatus := wslConn.DeriveConnStatus()
		if connStatus.Status != conncontroller.Status_Connected {
			return ConnUnion{}, fmt.Errorf("wsl connection %s not connected, cannot start shellproc", remoteName)
		}
		rtn.ConnType = ConnType_Wsl
		rtn.WslConn = wslConn
		rtn.WshEnabled = wshEnabled && wslConn.WshEnabled.Load()
	} else if conncontroller.IsLocalConnName(remoteName) {
		rtn.ConnType = ConnType_Local
		rtn.WshEnabled = wshEnabled
	} else {
		opts, err := remote.ParseOpts(remoteName)
		if err != nil {
			return ConnUnion{}, fmt.Errorf("invalid ssh remote name (%s): %w", remoteName, err)
		}
		conn := conncontroller.MaybeGetConn(opts)
		if conn == nil {
			return ConnUnion{}, fmt.Errorf("ssh connection not found: %s", remoteName)
		}
		connStatus := conn.DeriveConnStatus()
		if connStatus.Status != conncontroller.Status_Connected {
			return ConnUnion{}, fmt.Errorf("ssh connection %s not connected, cannot start shellproc", remoteName)
		}
		rtn.ConnType = ConnType_Ssh
		rtn.SshConn = conn
		rtn.WshEnabled = wshEnabled && conn.WshEnabled.Load()
	}
	err := rtn.getRemoteInfoAndShellType(blockMeta)
	if err != nil {
		return ConnUnion{}, err
	}
	return rtn, nil
}

func (bc *ShellController) setupAndStartShellProcess(logCtx context.Context, rc *RunShellOpts, blockMeta waveobj.MetaMapType) (*shellexec.ShellProc, *AgentRunInfo, error) {
	// create a circular blockfile for the output
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	fsErr := filestore.WFS.MakeFile(ctx, bc.BlockId, wavebase.BlockFile_Term, nil, wshrpc.FileOpts{MaxSize: DefaultTermMaxFileSize, Circular: true})
	if fsErr != nil && fsErr != fs.ErrExist {
		return nil, nil, fmt.Errorf("error creating blockfile: %w", fsErr)
	}
	if fsErr == fs.ErrExist {
		// reset the terminal state
		bc.resetTerminalState(logCtx)
	}
	bcInitStatus := bc.GetRuntimeStatus()
	if bcInitStatus.ShellProcStatus == Status_Running {
		return nil, nil, nil
	}
	// TODO better sync here (don't let two starts happen at the same times)
	remoteName := blockMeta.GetString(waveobj.MetaKey_Connection, "")
	connUnion, err := bc.getConnUnion(logCtx, remoteName, blockMeta)
	if err != nil {
		return nil, nil, err
	}
	blocklogger.Infof(logCtx, "[conndebug] remoteName: %q, connType: %s, wshEnabled: %v, shell: %q, shellType: %s\n", remoteName, connUnion.ConnType, connUnion.WshEnabled, connUnion.ShellPath, connUnion.ShellType)
	var cmdStr string
	var cmdOpts shellexec.CommandOptsType
	var agentRunInfo *AgentRunInfo
	if bc.ControllerType == BlockController_Shell {
		cmdOpts.Interactive = true
		cmdOpts.Login = true
		cmdOpts.Cwd, err = resolveCmdCwdForConn(blockMeta.GetString(waveobj.MetaKey_CmdCwd, ""), connUnion.ConnType == ConnType_Local)
		if err != nil {
			return nil, nil, err
		}
	} else if bc.ControllerType == BlockController_Cmd {
		var cmdOptsPtr *shellexec.CommandOptsType
		cmdStr, cmdOptsPtr, agentRunInfo, err = createCmdStrAndOpts(
			bc.BlockId,
			blockMeta,
			remoteName,
			connUnion.ConnType == ConnType_Local,
			connUnion.HomeDir,
		)
		if err != nil {
			return nil, nil, err
		}
		cmdOpts = *cmdOptsPtr
	} else {
		return nil, nil, fmt.Errorf("unknown controller type %q", bc.ControllerType)
	}
	var shellProc *shellexec.ShellProc
	swapToken := makeSwapToken(ctx, logCtx, bc.BlockId, blockMeta, remoteName, connUnion.ShellType)
	cmdOpts.SwapToken = swapToken
	blocklogger.Debugf(logCtx, "[conndebug] created swaptoken: %s\n", swapToken.Token)
	if connUnion.ConnType == ConnType_Wsl {
		wslConn := connUnion.WslConn
		if !connUnion.WshEnabled {
			shellProc, err = shellexec.StartWslShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, wslConn)
			if err != nil {
				return nil, nil, err
			}
		} else {
			sockName := wslConn.GetDomainSocketName()
			rpcContext := wshrpc.RpcContext{
				ProcRoute: true,
				SockName:  sockName,
				BlockId:   bc.BlockId,
				Conn:      wslConn.GetName(),
			}
			jwtStr, err := wshutil.MakeClientJWTToken(rpcContext)
			if err != nil {
				return nil, nil, fmt.Errorf("error making jwt token: %w", err)
			}
			swapToken.RpcContext = &rpcContext
			swapToken.Env[wshutil.WaveJwtTokenVarName] = jwtStr
			shellProc, err = shellexec.StartWslShellProc(ctx, rc.TermSize, cmdStr, cmdOpts, wslConn)
			if err != nil {
				wslConn.SetWshError(err)
				wslConn.WshEnabled.Store(false)
				blocklogger.Infof(logCtx, "[conndebug] error starting wsl shell proc with wsh: %v\n", err)
				blocklogger.Infof(logCtx, "[conndebug] attempting install without wsh\n")
				shellProc, err = shellexec.StartWslShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, wslConn)
				if err != nil {
					return nil, nil, err
				}
			}
		}
	} else if connUnion.ConnType == ConnType_Ssh {
		conn := connUnion.SshConn
		if !connUnion.WshEnabled {
			shellProc, err = shellexec.StartRemoteShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, conn)
			if err != nil {
				return nil, nil, err
			}
		} else {
			sockName := conn.GetDomainSocketName()
			rpcContext := wshrpc.RpcContext{
				ProcRoute: true,
				SockName:  sockName,
				BlockId:   bc.BlockId,
				Conn:      conn.Opts.String(),
			}
			jwtStr, err := wshutil.MakeClientJWTToken(rpcContext)
			if err != nil {
				return nil, nil, fmt.Errorf("error making jwt token: %w", err)
			}
			swapToken.RpcContext = &rpcContext
			swapToken.Env[wshutil.WaveJwtTokenVarName] = jwtStr
			shellProc, err = shellexec.StartRemoteShellProc(ctx, logCtx, rc.TermSize, cmdStr, cmdOpts, conn)
			if err != nil {
				conn.SetWshError(err)
				conn.WshEnabled.Store(false)
				blocklogger.Infof(logCtx, "[conndebug] error starting remote shell proc with wsh: %v\n", err)
				blocklogger.Infof(logCtx, "[conndebug] attempting install without wsh\n")
				shellProc, err = shellexec.StartRemoteShellProcNoWsh(ctx, rc.TermSize, cmdStr, cmdOpts, conn)
				if err != nil {
					return nil, nil, err
				}
			}
		}
	} else if connUnion.ConnType == ConnType_Local {
		if connUnion.WshEnabled {
			sockName := wavebase.GetMainRpcSocketName()
			rpcContext := wshrpc.RpcContext{
				ProcRoute: true,
				SockName:  sockName,
				BlockId:   bc.BlockId,
			}
			jwtStr, err := wshutil.MakeClientJWTToken(rpcContext)
			if err != nil {
				return nil, nil, fmt.Errorf("error making jwt token: %w", err)
			}
			swapToken.RpcContext = &rpcContext
			swapToken.Env[wshutil.WaveJwtTokenVarName] = jwtStr
		}
		cmdOpts.ShellPath = connUnion.ShellPath
		cmdOpts.ShellOpts = getLocalShellOpts(blockMeta)
		shellProc, err = shellexec.StartLocalShellProc(logCtx, rc.TermSize, cmdStr, cmdOpts, remoteName)
		if err != nil {
			return nil, nil, err
		}
	} else {
		return nil, nil, fmt.Errorf("unknown connection type for conn %q: %s", remoteName, connUnion.ConnType)
	}
	bc.UpdateControllerAndSendUpdate(func() bool {
		bc.ShellProc = shellProc
		bc.ProcStatus = Status_Running
		return true
	})
	if agentRunInfo != nil && agentRunInfo.CaptureCodexSessionId {
		go bc.captureCodexSessionIdForBlock(agentRunInfo)
	}
	return shellProc, agentRunInfo, nil
}

func (bc *ShellController) manageRunningShellProcess(
	shellProc *shellexec.ShellProc,
	rc *RunShellOpts,
	blockMeta waveobj.MetaMapType,
	agentRunInfo *AgentRunInfo,
) error {
	shellInputCh := make(chan *BlockInputUnion, 32)
	bc.ShellInputCh = shellInputCh

	go func() {
		// handles regular output from the pty (goes to the blockfile and xterm)
		defer func() {
			panichandler.PanicHandler("blockcontroller:shellproc-pty-read-loop", recover())
		}()
		defer func() {
			log.Printf("[shellproc] pty-read loop done\n")
			shellProc.Close()
			bc.WithLock(func() {
				// so no other events are sent
				bc.ShellInputCh = nil
			})
			shellProc.Cmd.Wait()
			exitCode := shellProc.Cmd.ExitCode()
			blockData := bc.getBlockData_noErr()
			if blockData != nil && blockData.Meta.GetString(waveobj.MetaKey_Controller, "") == BlockController_Cmd {
				termMsg := fmt.Sprintf("\r\nprocess finished with exit code = %d\r\n\r\n", exitCode)
				HandleAppendBlockFile(bc.BlockId, wavebase.BlockFile_Term, []byte(termMsg))
			}
			// to stop the inputCh loop
			time.Sleep(100 * time.Millisecond)
			close(shellInputCh) // don't use bc.ShellInputCh (it's nil)
		}()
		buf := make([]byte, 4096)
		for {
			nr, err := shellProc.Cmd.Read(buf)
			if nr > 0 {
				err := HandleAppendBlockFile(bc.BlockId, wavebase.BlockFile_Term, buf[:nr])
				if err != nil {
					log.Printf("error appending to blockfile: %v\n", err)
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("error reading from shell: %v\n", err)
				break
			}
		}
	}()
	go func() {
		// handles input from the shellInputCh, sent to pty
		// use shellInputCh instead of bc.ShellInputCh (because we want to be attached to *this* ch.  bc.ShellInputCh can be updated)
		defer func() {
			panichandler.PanicHandler("blockcontroller:shellproc-input-loop", recover())
		}()
		for ic := range shellInputCh {
			if len(ic.InputData) > 0 {
				shellProc.Cmd.Write(ic.InputData)
			}
			if ic.TermSize != nil {
				updateTermSize(shellProc, bc.BlockId, *ic.TermSize)
			}
		}
	}()
	go func() {
		defer func() {
			panichandler.PanicHandler("blockcontroller:shellproc-wait-loop", recover())
		}()
		// wait for the shell to finish
		var exitCode int
		defer func() {
			bc.UpdateControllerAndSendUpdate(func() bool {
				if bc.ProcStatus == Status_Running {
					bc.ProcStatus = Status_Done
				}
				bc.ProcExitCode = exitCode
				return true
			})
			if agentRunInfo != nil && bc.shouldClearAgentRuntimeMetaOnExit() {
				clearAgentRuntimeMeta(bc.BlockId)
			}
			releaseAgentStatus(bc.BlockId)
			log.Printf("[shellproc] shell process wait loop done\n")
		}()
		waitErr := shellProc.Cmd.Wait()
		exitCode = shellProc.Cmd.ExitCode()
		shellProc.SetWaitErrorAndSignalDone(waitErr)
		if agentRunInfo != nil && agentRunInfo.CaptureCodexSessionId {
			bc.captureCodexSessionIdForBlockWithAttempts(agentRunInfo, 3)
		}
		bc.resetTerminalState(context.Background())
		exitSignal := shellProc.Cmd.ExitSignal()
		var baseMsg string
		if bc.ControllerType == BlockController_Shell {
			baseMsg = "shell terminated"
		} else {
			baseMsg = "command exited"
		}
		msg := baseMsg
		if exitSignal != "" {
			msg = fmt.Sprintf("%s (signal %s)", baseMsg, exitSignal)
		} else if exitCode != 0 {
			msg = fmt.Sprintf("%s (exit code %d)", baseMsg, exitCode)
		}
		bc.writeMutedMessageToTerminal("[" + msg + "]")
		go checkCloseOnExit(bc.BlockId, exitCode)
	}()
	return nil
}

func (union *ConnUnion) getRemoteInfoAndShellType(blockMeta waveobj.MetaMapType) error {
	if !union.WshEnabled {
		return nil
	}
	if union.ConnType == ConnType_Ssh || union.ConnType == ConnType_Wsl {
		connRoute := wshutil.MakeConnectionRouteId(union.ConnName)
		remoteInfo, err := wshclient.RemoteGetInfoCommand(wshclient.GetBareRpcClient(), &wshrpc.RpcOpts{Route: connRoute, Timeout: 2000})
		if err != nil {
			// weird error, could flip the wshEnabled flag and allow it to go forward, but the connection should have already been vetted
			return fmt.Errorf("unable to obtain remote info from connserver: %w", err)
		}
		// TODO allow overriding remote shell path
		union.ShellPath = remoteInfo.Shell
		union.HomeDir = remoteInfo.HomeDir
	} else {
		shellPath, err := getLocalShellPath(blockMeta)
		if err != nil {
			return err
		}
		union.ShellPath = shellPath
		union.HomeDir = wavebase.GetHomeDir()
	}
	union.ShellType = shellutil.GetShellTypeFromShellPath(union.ShellPath)
	return nil
}

func checkCloseOnExit(blockId string, exitCode int) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		log.Printf("error getting block data: %v\n", err)
		return
	}
	closeOnExit := blockData.Meta.GetBool(waveobj.MetaKey_CmdCloseOnExit, false)
	closeOnExitForce := blockData.Meta.GetBool(waveobj.MetaKey_CmdCloseOnExitForce, false)
	if !closeOnExitForce && !(closeOnExit && exitCode == 0) {
		return
	}
	delayMs := blockData.Meta.GetFloat(waveobj.MetaKey_CmdCloseOnExitDelay, 2000)
	if delayMs < 0 {
		delayMs = 0
	}
	time.Sleep(time.Duration(delayMs) * time.Millisecond)
	rpcClient := wshclient.GetBareRpcClient()
	err = wshclient.DeleteBlockCommand(rpcClient, wshrpc.CommandDeleteBlockData{BlockId: blockId}, nil)
	if err != nil {
		log.Printf("error deleting block data (close on exit): %v\n", err)
	}
}

func getLocalShellPath(blockMeta waveobj.MetaMapType) (string, error) {
	shellPath := blockMeta.GetString(waveobj.MetaKey_TermLocalShellPath, "")
	if shellPath != "" {
		return shellPath, nil
	}

	connName := blockMeta.GetString(waveobj.MetaKey_Connection, "")
	if strings.HasPrefix(connName, "local:") {
		variant := strings.TrimPrefix(connName, "local:")
		if variant == LocalConnVariant_GitBash {
			if runtime.GOOS != "windows" {
				return "", fmt.Errorf("connection \"local:gitbash\" is only supported on Windows")
			}
			fullConfig := wconfig.GetWatcher().GetFullConfig()
			gitBashPath := shellutil.FindGitBash(&fullConfig, false)
			if gitBashPath == "" {
				return "", fmt.Errorf("connection \"local:gitbash\": git bash not found on this system, please install Git for Windows or set term:localshellpath to specify the git bash location")
			}
			return gitBashPath, nil
		}
		return "", fmt.Errorf("unsupported local connection type: %q", connName)
	}

	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if settings.TermLocalShellPath != "" {
		return settings.TermLocalShellPath, nil
	}
	return shellutil.DetectLocalShellPath(), nil
}

func getLocalShellOpts(blockMeta waveobj.MetaMapType) []string {
	if blockMeta.HasKey(waveobj.MetaKey_TermLocalShellOpts) {
		opts := blockMeta.GetStringList(waveobj.MetaKey_TermLocalShellOpts)
		return append([]string{}, opts...)
	}
	settings := wconfig.GetWatcher().GetFullConfig().Settings
	if len(settings.TermLocalShellOpts) > 0 {
		return append([]string{}, settings.TermLocalShellOpts...)
	}
	return nil
}

func resolveCmdCwdForConn(cwd string, isLocalConn bool) (string, error) {
	cwd = strings.TrimSpace(cwd)
	if cwd == "" {
		return "", nil
	}
	if !isLocalConn {
		return cwd, nil
	}
	return wavebase.ExpandHomeDir(cwd)
}

// for "cmd" type blocks
func createCmdStrAndOpts(
	blockId string,
	blockMeta waveobj.MetaMapType,
	connName string,
	isLocalConn bool,
	localHomeDir string,
) (string, *shellexec.CommandOptsType, *AgentRunInfo, error) {
	var cmdOpts shellexec.CommandOptsType
	cmdStr, cmdArgs, agentRunInfo, err := resolveAgentCmdAndArgs(blockId, blockMeta, isLocalConn, localHomeDir)
	if err != nil {
		return "", nil, nil, err
	}
	cmdOpts.Cwd = blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
	if cmdOpts.Cwd != "" {
		resolvedCwd, err := resolveCmdCwdForConn(cmdOpts.Cwd, isLocalConn)
		if err != nil {
			return "", nil, nil, err
		}
		cmdOpts.Cwd = resolvedCwd
	}
	if agentRunInfo != nil && agentRunInfo.CaptureCodexSessionId {
		agentRunInfo.CodexSessionLookupRoot = codexSessionLookupRoot(localHomeDir, blockMeta)
		if cmdOpts.Cwd != "" {
			agentRunInfo.CodexSessionLookupCwd = cmdOpts.Cwd
		} else {
			agentRunInfo.CodexSessionLookupCwd = localHomeDir
		}
		log.Printf(
			"starting codex session id capture (block=%s root=%q cwd=%q startedAt=%s)",
			blockId,
			agentRunInfo.CodexSessionLookupRoot,
			agentRunInfo.CodexSessionLookupCwd,
			agentRunInfo.CodexSessionStartedAt.Format(time.RFC3339Nano),
		)
	}
	useShell := blockMeta.GetBool(waveobj.MetaKey_CmdShell, true)
	if !useShell {
		if strings.Contains(cmdStr, " ") {
			return "", nil, nil, fmt.Errorf("cmd should not have spaces if cmd:shell is false (use cmd:args)")
		}
		// shell escape the args
		for _, arg := range cmdArgs {
			cmdStr = cmdStr + " " + utilfn.ShellQuote(arg, false, -1)
		}
	}
	cmdOpts.ForceJwt = blockMeta.GetBool(waveobj.MetaKey_CmdJwt, false) || agentRunInfo != nil
	return cmdStr, &cmdOpts, agentRunInfo, nil
}

func resolveAgentCmdAndArgs(
	blockId string,
	blockMeta waveobj.MetaMapType,
	isLocalConn bool,
	localHomeDir string,
) (string, []string, *AgentRunInfo, error) {
	cmdStr := blockMeta.GetString(waveobj.MetaKey_Cmd, "")
	if cmdStr == "" {
		return "", nil, nil, fmt.Errorf("missing cmd in block meta")
	}
	cmdArgs := append([]string{}, blockMeta.GetStringList(waveobj.MetaKey_CmdArgs)...)
	if !blockMeta.GetBool(MetaKey_AgentAutoResume, false) {
		return cmdStr, cmdArgs, nil, nil
	}
	provider := getAgentProvider(blockMeta, cmdStr)
	if provider == "" {
		return cmdStr, cmdArgs, nil, nil
	}
	sessionId := strings.TrimSpace(blockMeta.GetString(MetaKey_AgentSessionId, ""))
	hadSessionId := sessionId != ""
	agentRunInfo := &AgentRunInfo{
		Provider:  provider,
		SessionId: sessionId,
	}
	if provider == AgentProviderClaude && sessionId == "" {
		sessionId = uuid.NewString()
		agentRunInfo.SessionId = sessionId
		if err := persistAgentSessionId(blockId, sessionId); err != nil {
			log.Printf("error persisting claude agent session id (block=%s): %v", blockId, err)
			// Async retry: persist may fail under sqlite busy (single conn + 5s busy_timeout
			// vs 2s ctx). Retry must reuse the SAME sessionId so block meta stays aligned
			// with the running claude process's conversation history. Without this retry,
			// Outline/Note stays blank until a coincidental second resync re-runs 918.
			go captureClaudeSessionIdForBlock(blockId, sessionId)
		}
		cmdArgs = ensureClaudeSessionIdArg(cmdArgs, sessionId)
	}
	if hadSessionId {
		switch provider {
		case AgentProviderCodex:
			cmdArgs = append([]string{"resume", sessionId}, stripCodexResumeArgs(cmdArgs)...)
		case AgentProviderClaude:
			cmdArgs = append([]string{"--resume", sessionId}, stripClaudeSessionArgs(cmdArgs)...)
		case AgentProviderOpenCode:
			cmdArgs = append([]string{"--session", sessionId}, cmdArgs...)
		case AgentProviderPi:
			cmdArgs = append([]string{"--session-id", sessionId}, cmdArgs...)
		}
		return cmdStr, cmdArgs, agentRunInfo, nil
	}
	if provider == AgentProviderCodex && isLocalConn {
		agentRunInfo.CaptureCodexSessionId = true
		agentRunInfo.CodexSessionLookupHome = localHomeDir
		agentRunInfo.CodexSessionStartedAt = time.Now()
	}
	return cmdStr, cmdArgs, agentRunInfo, nil
}

func getAgentProvider(blockMeta waveobj.MetaMapType, cmd string) string {
	provider := strings.TrimSpace(strings.ToLower(blockMeta.GetString(MetaKey_AgentProvider, "")))
	if provider != "" {
		return provider
	}
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return ""
	}
	cmd = strings.ReplaceAll(cmd, "\\", "/")
	parts := strings.Split(cmd, "/")
	base := strings.ToLower(parts[len(parts)-1])
	for _, suffix := range []string{".exe", ".cmd", ".bat", ".ps1"} {
		base = strings.TrimSuffix(base, suffix)
	}
	return base
}

func ensureClaudeSessionIdArg(args []string, sessionId string) []string {
	if sessionId == "" {
		return args
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch arg {
		case "--session-id", "--resume", "-r", "--continue", "-c":
			return args
		}
		if strings.HasPrefix(arg, "--session-id=") || strings.HasPrefix(arg, "--resume=") {
			return args
		}
	}
	return append(args, "--session-id", sessionId)
}

func stripClaudeSessionArgs(args []string) []string {
	out := make([]string, 0, len(args))
	skipNext := false
	for _, arg := range args {
		if skipNext {
			skipNext = false
			continue
		}
		switch arg {
		case "--resume", "-r", "--session-id":
			skipNext = true
			continue
		case "--continue", "-c", "--fork-session":
			continue
		}
		if strings.HasPrefix(arg, "--resume=") || strings.HasPrefix(arg, "--session-id=") {
			continue
		}
		out = append(out, arg)
	}
	return out
}

func skipCodexOptionArgs(args []string, idx int) int {
	if idx < 0 || idx >= len(args) {
		return idx
	}
	arg := args[idx]
	if arg == "" {
		return idx
	}
	if arg == "--" {
		return idx + 1
	}
	flag := arg
	if eqIdx := strings.Index(arg, "="); eqIdx >= 0 {
		flag = arg[:eqIdx]
	}
	if codexOptionValueFlags[flag] {
		if strings.Contains(arg, "=") {
			return idx + 1
		}
		if idx+1 < len(args) {
			return idx + 2
		}
		return idx + 1
	}
	if codexOptionOnlyFlags[flag] {
		return idx + 1
	}
	if strings.HasPrefix(arg, "-") {
		return idx + 1
	}
	return idx
}

func findCodexResumeArgIndex(args []string) int {
	for idx := 0; idx < len(args); {
		if args[idx] == "resume" {
			return idx
		}
		nextIdx := skipCodexOptionArgs(args, idx)
		if nextIdx == idx {
			return -1
		}
		idx = nextIdx
	}
	return -1
}

func findCodexResumeSessionArgIndex(args []string, resumeIdx int) int {
	for idx := resumeIdx + 1; idx < len(args); {
		nextIdx := skipCodexOptionArgs(args, idx)
		if nextIdx != idx {
			idx = nextIdx
			continue
		}
		if strings.TrimSpace(args[idx]) == "" || strings.HasPrefix(args[idx], "-") {
			return -1
		}
		return idx
	}
	return -1
}

func stripCodexResumeArgs(args []string) []string {
	resumeIdx := findCodexResumeArgIndex(args)
	sessionIdx := -1
	if resumeIdx >= 0 {
		sessionIdx = findCodexResumeSessionArgIndex(args, resumeIdx)
	}
	out := make([]string, 0, len(args))
	for idx, arg := range args {
		if idx == resumeIdx || idx == sessionIdx {
			continue
		}
		if arg == "--last" || arg == "--all" || arg == "--include-non-interactive" {
			continue
		}
		out = append(out, arg)
	}
	return out
}

func resolveEnvReference(value string) string {
	ref := strings.TrimSpace(value)
	if strings.HasPrefix(ref, "$ENV:") {
		return strings.TrimSpace(os.Getenv(strings.TrimSpace(strings.TrimPrefix(ref, "$ENV:"))))
	}
	return value
}

func codexSessionLookupRoot(localHomeDir string, blockMeta waveobj.MetaMapType) string {
	cmdEnv := blockMeta.GetStringMap(waveobj.MetaKey_CmdEnv, true)
	codexHome := resolveEnvReference(cmdEnv["CODEX_HOME"])
	if codexHome == "" {
		codexHome = strings.TrimSpace(os.Getenv("CODEX_HOME"))
	}
	if codexHome != "" {
		if expanded, err := wavebase.ExpandHomeDir(codexHome); err == nil {
			return filepath.Join(expanded, "sessions")
		}
		return filepath.Join(codexHome, "sessions")
	}
	if localHomeDir == "" {
		return ""
	}
	return filepath.Join(localHomeDir, ".codex", "sessions")
}

func persistAgentSessionId(blockId string, sessionId string) error {
	if blockId == "" || sessionId == "" {
		return nil
	}
	tid := pslog.MakeAgentTraceId(blockId, sessionId)
	sessionRef := pslog.MakeSessionRef(sessionId)
	log.Printf("[ps-persist] enter block=%s sidref=%s trace=%s", blockId, sessionRef, tid)
	pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "persist-request", TraceId: tid, BlockId: blockId, SessionRef: sessionRef})
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	metaUpdate := map[string]any{
		MetaKey_AgentSessionId: sessionId,
	}
	err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId), metaUpdate, false)
	if err != nil {
		log.Printf("[ps-persist] FAIL block=%s err=%v trace=%s", blockId, err, tid)
		pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "persist-result", TraceId: tid, BlockId: blockId, SessionRef: sessionRef, Outcome: "error", Reason: "update-meta"})
		return err
	}
	wps.Broker.SendUpdateEvents(waveobj.ContextGetUpdatesRtn(ctx))
	log.Printf("[ps-persist] SENT block=%s sidref=%s trace=%s", blockId, sessionRef, tid)
	pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "persist-result", TraceId: tid, BlockId: blockId, SessionRef: sessionRef, Outcome: "ok"})
	return nil
}

// captureClaudeSessionIdForBlock retries persistAgentSessionId when the synchronous
// persist at resolveAgentCmdAndArgs:921 failed (typically sqlite busy_timeout racing
// the 2s ctx under concurrent writes). It reuses the SAME sessionId that was minted
// at :919 and pushed into claude args at :924 — retrying with a different id would
// desync block meta from the running claude process's conversation history.
//
// Loop:
//   - on each attempt, DBGet the block; if it's gone (destroyed) → abdicate
//   - if block meta already has agent:sessionid (second resync or rider won the race)
//     → abdicate (first-writer-wins; no sync.Once needed)
//   - else persistAgentSessionId and stop on success
//
// Up to claudeSessionCaptureMaxAttempts × claudeSessionCapturePollInterval (12s)
// gives enough headroom for a coincidental second resync to also fail and recover;
// retry doesn't scan disk (claude id is in backend memory, not in CLI-written files
// like codex).
//
// trace: one traceId per capture call (ps-capture), emitted at every branch so the
// "Windows claude agent 状态不更新" chain can be grep'd end-to-end. This is the
// suspected silent-abdicate site — every return was previously mute.
func captureClaudeSessionIdForBlock(blockId string, sessionId string) {
	if blockId == "" || sessionId == "" {
		return
	}
	tid := pslog.MakeAgentTraceId(blockId, sessionId)
	sessionRef := pslog.MakeSessionRef(sessionId)
	pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "capture-request", TraceId: tid, BlockId: blockId, SessionRef: sessionRef})
	for i := 0; i < claudeSessionCaptureMaxAttempts; i++ {
		if i > 0 {
			time.Sleep(claudeSessionCapturePollInterval)
		}
		ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
		block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
		cancelFn()
		if err != nil || block == nil {
			pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "capture-result", TraceId: tid, BlockId: blockId, SessionRef: sessionRef, Outcome: "stopped", Reason: "block-gone"})
			return // block gone (destroyed)
		}
		if existingSid := block.Meta.GetString(MetaKey_AgentSessionId, ""); existingSid != "" {
			pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "capture-result", TraceId: tid, BlockId: blockId, SessionRef: pslog.MakeSessionRef(existingSid), Outcome: "stopped", Reason: "session-exists"})
			return // second resync or rider already persisted
		}
		if err := persistAgentSessionId(blockId, sessionId); err == nil {
			log.Printf("[ps-capture] retry-persisted block=%s attempt=%d trace=%s", blockId, i+1, tid)
			pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "capture-result", TraceId: tid, BlockId: blockId, SessionRef: sessionRef, Outcome: "ok"})
			return
		} else {
			pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "capture-retry", TraceId: tid, BlockId: blockId, SessionRef: sessionRef, Outcome: "error"})
		}
	}
	log.Printf("claude agent session id retry gave up (block=%s, attempts=%d, trace=%s)", blockId, claudeSessionCaptureMaxAttempts, tid)
	pslog.AppendEvent(pslog.Event{Name: "agent.session", Stage: "capture-result", TraceId: tid, BlockId: blockId, SessionRef: sessionRef, Outcome: "error", Reason: "retry-exhausted"})
}

func (bc *ShellController) shouldClearAgentRuntimeMetaOnExit() bool {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	return !bc.KeepAgentMetaOnExit
}

func clearAgentRuntimeMeta(blockId string) {
	if blockId == "" {
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	metaUpdate := agentRuntimeMetaClearUpdate()
	if err := wstore.UpdateObjectMeta(ctx, waveobj.MakeORef(waveobj.OType_Block, blockId), metaUpdate, false); err != nil {
		log.Printf("error clearing agent runtime meta (block=%s): %v", blockId, err)
		return
	}
	wps.Broker.SendUpdateEvents(waveobj.ContextGetUpdatesRtn(ctx))
}

func agentRuntimeMetaClearUpdate() map[string]any {
	return map[string]any{
		waveobj.MetaKey_Controller:    BlockController_Shell,
		waveobj.MetaKey_Cmd:           nil,
		waveobj.MetaKey_CmdArgs:       nil,
		waveobj.MetaKey_CmdEnv:        nil,
		waveobj.MetaKey_CmdShell:      nil,
		waveobj.MetaKey_CmdJwt:        nil,
		waveobj.MetaKey_CmdRunOnStart: nil,
		MetaKey_AgentAutoResume:       nil,
		MetaKey_AgentProvider:         nil,
		MetaKey_AgentSessionId:        nil,
	}
}

func agentShellShutdownResumeMetaUpdate(blockMeta waveobj.MetaMapType, rtInfo *waveobj.ObjRTInfo) waveobj.MetaMapType {
	if blockMeta.GetString(waveobj.MetaKey_Controller, "") != BlockController_Shell {
		return nil
	}
	if !blockMeta.GetBool(MetaKey_AgentAutoResume, false) {
		return nil
	}
	if strings.TrimSpace(blockMeta.GetString(MetaKey_AgentSessionId, "")) == "" {
		return nil
	}
	if rtInfo == nil || rtInfo.ShellState != "running-command" {
		return nil
	}
	provider := getAgentProvider(blockMeta, blockMeta.GetString(waveobj.MetaKey_Cmd, ""))
	if provider != AgentProviderCodex && provider != AgentProviderClaude {
		return nil
	}
	return waveobj.MetaMapType{
		waveobj.MetaKey_Controller:    BlockController_Cmd,
		waveobj.MetaKey_Cmd:           provider,
		waveobj.MetaKey_CmdArgs:       nil,
		waveobj.MetaKey_CmdShell:      false,
		waveobj.MetaKey_CmdJwt:        true,
		waveobj.MetaKey_CmdRunOnStart: true,
		MetaKey_AgentAutoResume:       true,
		MetaKey_AgentProvider:         provider,
	}
}

func isAsciiLetter(char byte) bool {
	return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')
}

func normalizeCwdForComparison(cwd string) string {
	cleaned := strings.TrimSpace(cwd)
	if cleaned == "" {
		return ""
	}
	cleaned = strings.ReplaceAll(cleaned, "\\", "/")
	cleaned = path.Clean(cleaned)
	if len(cleaned) >= 7 && strings.EqualFold(cleaned[:5], "/mnt/") && isAsciiLetter(cleaned[5]) && cleaned[6] == '/' {
		cleaned = strings.ToLower(cleaned[5:6]) + ":" + cleaned[6:]
	}
	if len(cleaned) >= 13 && strings.EqualFold(cleaned[:10], "/cygdrive/") && isAsciiLetter(cleaned[10]) && cleaned[11] == '/' {
		cleaned = strings.ToLower(cleaned[10:11]) + ":" + cleaned[11:]
	}
	if len(cleaned) >= 3 && cleaned[0] == '/' && isAsciiLetter(cleaned[1]) && cleaned[2] == '/' {
		cleaned = strings.ToLower(cleaned[1:2]) + ":" + cleaned[2:]
	}
	if len(cleaned) >= 2 && isAsciiLetter(cleaned[0]) && cleaned[1] == ':' {
		return strings.ToLower(cleaned)
	}
	if runtime.GOOS == "windows" {
		return strings.ToLower(cleaned)
	}
	return cleaned
}

func codexSessionDayDirCandidates(startTs time.Time) []string {
	now := time.Now()
	candidateTimes := []time.Time{
		startTs.AddDate(0, 0, -1),
		startTs,
		startTs.AddDate(0, 0, 1),
		now.AddDate(0, 0, -1),
		now,
		now.AddDate(0, 0, 1),
	}
	seen := make(map[string]bool)
	var dirs []string
	for _, ts := range candidateTimes {
		if ts.IsZero() {
			continue
		}
		dir := filepath.Join(ts.Format("2006"), ts.Format("01"), ts.Format("02"))
		if seen[dir] {
			continue
		}
		seen[dir] = true
		dirs = append(dirs, dir)
	}
	return dirs
}

func parseCodexSessionTimestamp(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	timestamp, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return timestamp
}

func readCodexSessionMeta(filePath string) (string, string, time.Time, error) {
	fd, err := os.Open(filePath)
	if err != nil {
		return "", "", time.Time{}, err
	}
	defer fd.Close()

	scanner := bufio.NewScanner(fd)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for lineCount := 0; lineCount < codexSessionMetaScanLines && scanner.Scan(); lineCount++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var metaLine codexSessionMetaLine
		if err := json.Unmarshal([]byte(line), &metaLine); err != nil {
			continue
		}
		if metaLine.Type != "session_meta" {
			continue
		}
		if metaLine.Payload.Id == "" || metaLine.Payload.Cwd == "" {
			continue
		}
		timestamp := parseCodexSessionTimestamp(metaLine.Payload.Timestamp)
		if timestamp.IsZero() {
			timestamp = parseCodexSessionTimestamp(metaLine.Timestamp)
		}
		if timestamp.IsZero() {
			if stat, err := fd.Stat(); err == nil {
				timestamp = stat.ModTime()
			}
		}
		return metaLine.Payload.Id, metaLine.Payload.Cwd, timestamp, nil
	}
	if err := scanner.Err(); err != nil {
		return "", "", time.Time{}, err
	}
	return "", "", time.Time{}, nil
}

func findUniqueCodexSessionIdInRoot(sessionsRoot string, cwd string, startedAt time.Time) (string, int, error) {
	if sessionsRoot == "" || cwd == "" {
		return "", 0, nil
	}
	normalizedCwd := normalizeCwdForComparison(cwd)
	if normalizedCwd == "." || normalizedCwd == "" {
		return "", 0, nil
	}
	searchSince := startedAt
	var candidates []codexSessionCandidate
	for _, dayDir := range codexSessionDayDirCandidates(startedAt) {
		matches, _ := filepath.Glob(filepath.Join(sessionsRoot, dayDir, "rollout-*.jsonl"))
		for _, match := range matches {
			sessionId, sessionCwd, sessionTs, err := readCodexSessionMeta(match)
			if err != nil || sessionId == "" || sessionCwd == "" {
				continue
			}
			if normalizeCwdForComparison(sessionCwd) != normalizedCwd {
				continue
			}
			if sessionTs.IsZero() || sessionTs.Before(searchSince) {
				continue
			}
			candidates = append(candidates, codexSessionCandidate{
				SessionId: sessionId,
				Cwd:       sessionCwd,
				Timestamp: sessionTs,
				Path:      match,
			})
		}
	}
	if len(candidates) != 1 {
		return "", len(candidates), nil
	}
	return candidates[0].SessionId, 1, nil
}

func findUniqueCodexSessionId(homeDir string, cwd string, startedAt time.Time) (string, int, error) {
	if homeDir == "" {
		return "", 0, nil
	}
	return findUniqueCodexSessionIdInRoot(filepath.Join(homeDir, ".codex", "sessions"), cwd, startedAt)
}

func (bc *ShellController) captureCodexSessionIdForBlock(agentRunInfo *AgentRunInfo) {
	bc.captureCodexSessionIdForBlockWithAttempts(agentRunInfo, codexSessionCaptureMaxAttempts)
}

func (bc *ShellController) captureCodexSessionIdForBlockWithAttempts(agentRunInfo *AgentRunInfo, maxAttempts int) {
	if agentRunInfo == nil || !agentRunInfo.CaptureCodexSessionId {
		return
	}
	sessionsRoot := agentRunInfo.CodexSessionLookupRoot
	if sessionsRoot == "" && agentRunInfo.CodexSessionLookupHome != "" {
		sessionsRoot = filepath.Join(agentRunInfo.CodexSessionLookupHome, ".codex", "sessions")
	}
	if sessionsRoot == "" || agentRunInfo.CodexSessionLookupCwd == "" {
		log.Printf(
			"skipping codex session id capture because lookup context is incomplete (block=%s root=%q cwd=%q)",
			bc.BlockId,
			sessionsRoot,
			agentRunInfo.CodexSessionLookupCwd,
		)
		return
	}
	var candidateId string
	var candidateFirstSeen time.Time
	for attempt := 0; attempt < maxAttempts; attempt++ {
		sessionId, matchCount, err := findUniqueCodexSessionIdInRoot(
			sessionsRoot,
			agentRunInfo.CodexSessionLookupCwd,
			agentRunInfo.CodexSessionStartedAt,
		)
		if err != nil {
			log.Printf("error finding codex session id (block=%s): %v", bc.BlockId, err)
			return
		}
		if matchCount > 1 {
			log.Printf(
				"ambiguous codex session id capture (block=%s cwd=%q matches=%d); not persisting agent session id",
				bc.BlockId,
				agentRunInfo.CodexSessionLookupCwd,
				matchCount,
			)
			return
		}
		if sessionId != "" {
			now := time.Now()
			if candidateId != sessionId {
				candidateId = sessionId
				candidateFirstSeen = now
			} else if now.Sub(candidateFirstSeen) >= codexSessionCaptureSettleDuration {
				if err := persistAgentSessionId(bc.BlockId, sessionId); err != nil {
					log.Printf("error persisting codex session id (block=%s): %v", bc.BlockId, err)
				}
				log.Printf("persisted codex session id (block=%s session=%s)", bc.BlockId, sessionId)
				return
			}
		}
		sleepDuration := 2 * time.Second
		if attempt < codexSessionCaptureQuickAttempts {
			sleepDuration = 400 * time.Millisecond
		}
		time.Sleep(sleepDuration)
	}
	log.Printf(
		"timed out capturing codex session id (block=%s cwd=%q root=%q attempts=%d)",
		bc.BlockId,
		agentRunInfo.CodexSessionLookupCwd,
		sessionsRoot,
		maxAttempts,
	)
}

func CaptureManualCodexSessionIdForBlock(blockId string, startedAt time.Time) {
	if blockId == "" {
		return
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	blockData, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil || blockData == nil {
		if err != nil {
			log.Printf("error loading block for manual codex session capture (block=%s): %v", blockId, err)
		}
		return
	}
	blockMeta := blockData.Meta
	if blockMeta.GetString(MetaKey_AgentSessionId, "") != "" {
		return
	}
	if getAgentProvider(blockMeta, blockMeta.GetString(waveobj.MetaKey_Cmd, "")) != AgentProviderCodex {
		return
	}
	if !blockMeta.GetBool(MetaKey_AgentAutoResume, false) {
		return
	}
	cwd := strings.TrimSpace(blockMeta.GetString(waveobj.MetaKey_CmdCwd, ""))
	if cwd == "" {
		cwd = wavebase.GetHomeDir()
	}
	expandedCwd, err := wavebase.ExpandHomeDir(cwd)
	if err == nil {
		cwd = expandedCwd
	}
	agentRunInfo := &AgentRunInfo{
		Provider:               AgentProviderCodex,
		CaptureCodexSessionId:  true,
		CodexSessionLookupHome: wavebase.GetHomeDir(),
		CodexSessionLookupRoot: codexSessionLookupRoot(wavebase.GetHomeDir(), blockMeta),
		CodexSessionLookupCwd:  cwd,
		CodexSessionStartedAt:  startedAt,
	}
	bc := &ShellController{BlockId: blockId}
	bc.captureCodexSessionIdForBlockWithAttempts(agentRunInfo, ManualCodexSessionCaptureAttempts)
}

// CaptureManualClaudeSessionIdForBlock is the SetMetaCommand rider entry for claude.
// Triggered by maybeCaptureManualClaudeSessionId in wshserver when a SetMeta patch
// hits a stale claude block (no sessionid, agent:autoresume=true, provider=claude).
// Unlike codex (which scans disk for a CLI-written session_meta), claude has no
// in-flight id to recover — we mint a fresh one and persist it, so the next spawn
// of this block will use `claude --session-id <newUuid>`. Aborts if block is gone,
// already has an id (race against the main path or manual user patch), or no longer
// matches the claude+autoresume shape.
func CaptureManualClaudeSessionIdForBlock(blockId string, startedAt time.Time) {
	_ = startedAt // kept for symmetry with codex signature; claude doesn't need it
	if blockId == "" {
		return
	}
	for i := 0; i < claudeManualCaptureMaxAttempts; i++ {
		if i > 0 {
			time.Sleep(claudeManualCapturePollInterval)
		}
		ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
		block, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
		cancelFn()
		if err != nil || block == nil {
			return // block gone
		}
		blockMeta := block.Meta
		if blockMeta.GetString(MetaKey_AgentSessionId, "") != "" {
			return // already persisted by main path or manual patch
		}
		if getAgentProvider(blockMeta, blockMeta.GetString(waveobj.MetaKey_Cmd, "")) != AgentProviderClaude {
			return
		}
		if !blockMeta.GetBool(MetaKey_AgentAutoResume, false) {
			return
		}
		if err := persistAgentSessionId(blockId, uuid.NewString()); err == nil {
			log.Printf("manual claude agent session id persisted (block=%s, attempt=%d)", blockId, i+1)
			return
		}
	}
}

func (bc *ShellController) getBlockData_noErr() *waveobj.Block {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	blockData, err := wstore.DBGet[*waveobj.Block](ctx, bc.BlockId)
	if err != nil {
		log.Printf("error getting block data (getBlockData_noErr): %v\n", err)
		return nil
	}
	return blockData
}

func resolveEnvMap(blockId string, blockMeta waveobj.MetaMapType, connName string) (map[string]string, error) {
	rtn := make(map[string]string)
	config := wconfig.GetWatcher().GetFullConfig()
	connKeywords := config.Connections[connName]
	ckEnv := connKeywords.CmdEnv
	for k, v := range ckEnv {
		rtn[k] = resolveEnvReference(v)
	}
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	_, envFileData, err := filestore.WFS.ReadFile(ctx, blockId, wavebase.BlockFile_Env)
	if err == fs.ErrNotExist {
		err = nil
	}
	if err != nil {
		return nil, fmt.Errorf("error reading command env file: %w", err)
	}
	if len(envFileData) > 0 {
		envMap := envutil.EnvToMap(string(envFileData))
		for k, v := range envMap {
			rtn[k] = v
		}
	}
	cmdEnv := blockMeta.GetStringMap(waveobj.MetaKey_CmdEnv, true)
	for k, v := range cmdEnv {
		if v == waveobj.MetaMap_DeleteSentinel {
			delete(rtn, k)
			continue
		}
		rtn[k] = resolveEnvReference(v)
	}
	connEnv := blockMeta.GetConnectionOverride(connName).GetStringMap(waveobj.MetaKey_CmdEnv, true)
	for k, v := range connEnv {
		if v == waveobj.MetaMap_DeleteSentinel {
			delete(rtn, k)
			continue
		}
		rtn[k] = resolveEnvReference(v)
	}
	return rtn, nil
}

// ResolveBlockEnvMap fetches the block's meta from the store and returns the env map that
// the shell process actually receives on startup.
//
// For local connections: the env is built from the OS environ baseline, the wave-injected
// local env vars, and the per-block command-env deltas resolved by resolveEnvMap
// (connection cmd:env + runtime BlockFile_Env + block meta cmd:env + connection override cmd:env)
// honoring MetaMap_DeleteSentinel as unset.
//
// For remote connections: only the per-block command-env deltas are returned — the OS baseline
// belongs to the local wshserver process, not the remote host, so synthesizing it would
// misrepresent the remote shell's PATH/HOME/etc. Such blocks visibly have fewer vars; the
// modal title indicates a remote connection so users know what they're looking at.
func ResolveBlockEnvMap(blockId string, connName string) (map[string]string, error) {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	blockData, err := wstore.DBGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return nil, fmt.Errorf("error getting block data: %w", err)
	}
	if blockData == nil {
		return nil, fmt.Errorf("block not found: %s", blockId)
	}
	delta, err := resolveEnvMap(blockId, blockData.Meta, connName)
	if err != nil {
		return nil, err
	}
	if !conncontroller.IsLocalConnName(connName) {
		// Remote: drop delete-sentinels; the caller expects a flat KEY->value map.
		rtn := make(map[string]string, len(delta))
		for k, v := range delta {
			if v == waveobj.MetaMap_DeleteSentinel {
				continue
			}
			rtn[k] = v
		}
		return rtn, nil
	}
	rtn := make(map[string]string)
	for _, envStr := range os.Environ() {
		key, val, ok := strings.Cut(envStr, "=")
		if !ok || key == "" {
			continue
		}
		rtn[key] = val
	}
	for k, v := range shellutil.WaveshellLocalEnvVars(shellutil.DefaultTermType) {
		rtn[k] = v
	}
	for k, v := range delta {
		if v == waveobj.MetaMap_DeleteSentinel {
			delete(rtn, k)
			continue
		}
		rtn[k] = v
	}
	return rtn, nil
}

func getCustomInitScriptKeyCascade(shellType string) []string {
	if shellType == "bash" {
		return []string{waveobj.MetaKey_CmdInitScriptBash, waveobj.MetaKey_CmdInitScriptSh, waveobj.MetaKey_CmdInitScript}
	}
	if shellType == "zsh" {
		return []string{waveobj.MetaKey_CmdInitScriptZsh, waveobj.MetaKey_CmdInitScriptSh, waveobj.MetaKey_CmdInitScript}
	}
	if shellType == "pwsh" {
		return []string{waveobj.MetaKey_CmdInitScriptPwsh, waveobj.MetaKey_CmdInitScript}
	}
	if shellType == "fish" {
		return []string{waveobj.MetaKey_CmdInitScriptFish, waveobj.MetaKey_CmdInitScript}
	}
	return []string{waveobj.MetaKey_CmdInitScript}
}

func getCustomInitScript(logCtx context.Context, meta waveobj.MetaMapType, connName string, shellType string) string {
	initScriptVal, metaKeyName := getCustomInitScriptValue(meta, connName, shellType)
	if initScriptVal == "" {
		return ""
	}
	if !fileutil.IsInitScriptPath(initScriptVal) {
		blocklogger.Infof(logCtx, "[conndebug] inline initScript (size=%d) found in meta key: %s\n", len(initScriptVal), metaKeyName)
		return initScriptVal
	}
	blocklogger.Infof(logCtx, "[conndebug] initScript detected as a file %q from meta key: %s\n", initScriptVal, metaKeyName)
	initScriptVal, err := wavebase.ExpandHomeDir(initScriptVal)
	if err != nil {
		blocklogger.Infof(logCtx, "[conndebug] cannot expand home dir in Wave initscript file: %v\n", err)
		return fmt.Sprintf("echo \"cannot expand home dir in Wave initscript file, from key %s\";\n", metaKeyName)
	}
	fileData, err := os.ReadFile(initScriptVal)
	if err != nil {
		blocklogger.Infof(logCtx, "[conndebug] cannot open Wave initscript file: %v\n", err)
		return fmt.Sprintf("echo \"cannot open Wave initscript file, from key %s\";\n", metaKeyName)
	}
	if len(fileData) > MaxInitScriptSize {
		blocklogger.Infof(logCtx, "[conndebug] initscript file too large, size=%d, max=%d\n", len(fileData), MaxInitScriptSize)
		return fmt.Sprintf("echo \"initscript file too large, from key %s\";\n", metaKeyName)
	}
	if utilfn.HasBinaryData(fileData) {
		blocklogger.Infof(logCtx, "[conndebug] initscript file contains binary data\n")
		return fmt.Sprintf("echo \"initscript file contains binary data, from key %s\";\n", metaKeyName)
	}
	blocklogger.Infof(logCtx, "[conndebug] initscript file read successfully, size=%d\n", len(fileData))
	return string(fileData)
}

// returns (value, metakey)
func getCustomInitScriptValue(meta waveobj.MetaMapType, connName string, shellType string) (string, string) {
	keys := getCustomInitScriptKeyCascade(shellType)
	connMeta := meta.GetConnectionOverride(connName)
	if connMeta != nil {
		for _, key := range keys {
			if connMeta.HasKey(key) {
				return connMeta.GetString(key, ""), "blockmeta/[" + connName + "]/" + key
			}
		}
	}
	for _, key := range keys {
		if meta.HasKey(key) {
			return meta.GetString(key, ""), "blockmeta/" + key
		}
	}
	fullConfig := wconfig.GetWatcher().GetFullConfig()
	connKeywords := fullConfig.Connections[connName]
	connKeywordsMap := make(map[string]any)
	err := utilfn.ReUnmarshal(&connKeywordsMap, connKeywords)
	if err != nil {
		log.Printf("error re-unmarshalling connKeywords: %v\n", err)
		return "", ""
	}
	ckMeta := waveobj.MetaMapType(connKeywordsMap)
	for _, key := range keys {
		if ckMeta.HasKey(key) {
			return ckMeta.GetString(key, ""), "connections.json/" + connName + "/" + key
		}
	}
	return "", ""
}

func updateTermSize(shellProc *shellexec.ShellProc, blockId string, termSize waveobj.TermSize) {
	err := setTermSizeInDB(blockId, termSize)
	if err != nil {
		log.Printf("error setting pty size: %v\n", err)
	}
	err = shellProc.Cmd.SetSize(termSize.Rows, termSize.Cols)
	if err != nil {
		log.Printf("error setting pty size: %v\n", err)
	}
}

func setTermSizeInDB(blockId string, termSize waveobj.TermSize) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	ctx = waveobj.ContextWithUpdates(ctx)
	bdata, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block data: %v", err)
	}
	if bdata.RuntimeOpts == nil {
		bdata.RuntimeOpts = &waveobj.RuntimeOpts{}
	}
	bdata.RuntimeOpts.TermSize = termSize
	err = wstore.DBUpdate(ctx, bdata)
	if err != nil {
		return fmt.Errorf("error updating block data: %v", err)
	}
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	wps.Broker.SendUpdateEvents(updates)
	return nil
}
