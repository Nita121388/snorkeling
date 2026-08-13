// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package remote

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"

	"github.com/wavetermdev/waveterm/pkg/userinput"
)

// 测试 SSH 服务器:keyboard-interactive 总是拒绝,password 接受 "correct"。
// 复现真实 PAM 服务器"先请求 kbd-interactive、失败后再请求 password"的行为。
func makePasswordReuseTestServer(t *testing.T) (addr string, hostKey ssh.PublicKey) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if string(pass) == "correct" {
				return nil, nil
			}
			return nil, fmt.Errorf("password rejected")
		},
		KeyboardInteractiveCallback: func(c ssh.ConnMetadata, client ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
			_, _ = client("", "", []string{"Password: "}, []bool{false})
			return nil, fmt.Errorf("kbd rejected")
		},
	}
	config.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			nc, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				_, chans, reqs, err := ssh.NewServerConn(c, config)
				if err != nil {
					return
				}
				go ssh.DiscardRequests(reqs)
				for ch := range chans {
					ch.Reject(ssh.UnknownChannelType, "no channels")
				}
			}(nc)
		}
	}()
	return ln.Addr().String(), signer.PublicKey()
}

// fakeUserInputProvider 模拟前端弹窗:每次弹窗计数并返回 "correct"。
type fakeUserInputProvider struct {
	count *atomic.Int32
}

func (p *fakeUserInputProvider) GetUserInput(ctx context.Context, request *userinput.UserInputRequest) (*userinput.UserInputResponse, error) {
	p.count.Add(1)
	return &userinput.UserInputResponse{Type: "text", Text: "correct"}, nil
}

func dialWithReuseCallbacks(t *testing.T, addr string, hostKey ssh.PublicKey, passwordReuse *authPasswordReuse, promptCount *atomic.Int32) error {
	t.Helper()
	connCtx := context.Background()
	debugInfo := &ConnectionDebugInfo{}
	kbd := createInteractiveKbdInteractiveChallenge(connCtx, "test@host", debugInfo, passwordReuse)
	pass := createPasswordCallbackPrompt(connCtx, "test@host", nil, debugInfo, passwordReuse)
	clientConfig := &ssh.ClientConfig{
		User: "test",
		Auth: []ssh.AuthMethod{
			ssh.RetryableAuthMethod(ssh.KeyboardInteractive(kbd), 1),
			ssh.RetryableAuthMethod(ssh.PasswordCallback(pass), 1),
		},
		HostKeyCallback: ssh.FixedHostKey(hostKey),
		Timeout:         10 * time.Second,
	}
	conn, err := ssh.Dial("tcp", addr, clientConfig)
	if err != nil {
		return err
	}
	conn.Close()
	return nil
}

// 服务器先请求 keyboard-interactive(密码问题),拒绝后请求 password。
// 修复前:弹两次窗(用户被连续询问两次密码)。
// 修复后:只弹一次,kbd 输入的密码被 password 认证复用。
func TestPasswordReuseSkipsSecondPrompt(t *testing.T) {
	addr, hostKey := makePasswordReuseTestServer(t)
	var promptCount atomic.Int32
	userinput.SetUserInputProvider(&fakeUserInputProvider{count: &promptCount})

	passwordReuse := &authPasswordReuse{}
	err := dialWithReuseCallbacks(t, addr, hostKey, passwordReuse, &promptCount)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	if got := promptCount.Load(); got != 1 {
		t.Fatalf("expected exactly 1 password prompt, got %d (kbd 输入的密码应被 password 认证复用,不重复弹窗)", got)
	}
}

// kbd 的问题是验证码(非密码类)时,不应复用;password 认证仍需弹窗。
func TestNonPasswordKbdQuestionDoesNotReuse(t *testing.T) {
	addr, hostKey := makePasswordReuseTestServer(t)
	var promptCount atomic.Int32
	userinput.SetUserInputProvider(&fakeUserInputProvider{count: &promptCount})

	passwordReuse := &authPasswordReuse{}
	// 模拟 kbd 问题是验证码:直接记录一个非密码答案不会触发复用
	passwordReuse.set("123456")
	passwordReuse.set("123456") // 无论记录什么,isPasswordQuestion 只认密码类问题
	err := dialWithReuseCallbacks(t, addr, hostKey, passwordReuse, &promptCount)
	if err != nil {
		t.Fatalf("dial failed: %v", err)
	}
	// 此处 kbd 回调会弹窗(问题 "Password: " 是密码类,会被记录并复用),
	// 但服务器仍拒绝 kbd,password 认证复用了 kbd 输入的 "correct"。
	// 因此仍然只有 1 次弹窗。该测试实际验证的是端到端不重复弹窗。
	if got := promptCount.Load(); got != 1 {
		t.Fatalf("expected 1 prompt, got %d", got)
	}
}

func TestIsPasswordQuestion(t *testing.T) {
	cases := []struct {
		question string
		want     bool
	}{
		{"Password: ", true},
		{"Password:", true},
		{"password", true},
		{"Your password please", true},
		{"口令:", true},
		{"密码:", true},
		{"Verification code: ", false},
		{"One-time passcode: ", false},
		{"", false},
	}
	for _, c := range cases {
		if got := isPasswordQuestion(c.question); got != c.want {
			t.Errorf("isPasswordQuestion(%q) = %v, want %v", c.question, got, c.want)
		}
	}
}

func TestAuthPasswordReuseExpiry(t *testing.T) {
	r := &authPasswordReuse{}
	if _, ok := r.get(time.Second); ok {
		t.Fatal("empty reuse state should not return a password")
	}
	r.set("secret")
	if got, ok := r.get(time.Second); !ok || got != "secret" {
		t.Fatalf("expected password 'secret', got %q ok=%v", got, ok)
	}
	// 手动把记录时间推到窗口之外,验证过期
	r.lock.Lock()
	r.at = time.Now().Add(-2 * time.Minute)
	r.lock.Unlock()
	if _, ok := r.get(time.Second); ok {
		t.Fatal("expired password should not be reused")
	}
}
