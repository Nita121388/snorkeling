# 红证：N-1124-agent-cmd-resolve2

日期：2026-11-24

## 判据红在旧代码上（sh 源文件回滚到 HEAD 后跑新测试）

```
 × frontend/app/workspace/agent-launch.test.ts > agent launch context > resolves local agent commands to an absolute path before launch 5ms
 × frontend/app/workspace/agent-launch.test.ts > agent launch context > resolves local agent commands with a null connection 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 49 passed (51)
```

## 运行机制复现（GUI 裸 PATH 等价环境）

```
$ env -i HOME=$HOME /bin/zsh -c "opencode --version"
zsh:1: command not found: opencode
$ env -i HOME=$HOME /bin/zsh -c "/Users/nita/.opencode/bin/opencode --version"
1.19.6
```
