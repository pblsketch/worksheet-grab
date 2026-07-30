#!/usr/bin/env node
// SessionStart 훅 — 병행 세션 자동 경고(비차단). 근거: docs/CONCURRENT-SESSIONS.md.
// 어떤 경우에도 세션을 막거나 오류로 끝내지 않는다(try/catch + 항상 exit 0).
// 개발(3층) 자산 — 배포 번들에는 포함되지 않는다(scripts/build-user-bundle.mjs FORBID_UNDER_CLAUDE).

import { execSync } from 'node:child_process';

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}

try {
  const dirty = sh('git status --porcelain');
  const worktrees = sh('git worktree list').split('\n').filter(Boolean);
  const msgs = [];
  if (dirty) {
    msgs.push('⚠ 작업 트리에 커밋 안 된 변경이 있습니다 — 다른 세션이 살아 있을 수 있습니다.');
    msgs.push('  내가 고칠 파일이 남의 손에 있으면 멈추고 알리세요(CONCURRENT-SESSIONS.md §2-5). git add -A/브랜치전환/stash 금지.');
  }
  if (worktrees.length > 1) {
    msgs.push(`ℹ 워크트리 ${worktrees.length}개 활성 — 병행 작업 가능성. 큰 변경은 격리 워크트리에서(§1).`);
  }
  if (msgs.length) console.log('[병행 세션 점검]\n' + msgs.join('\n'));
} catch { /* 무슨 일이 있어도 세션을 막지 않는다 */ }

process.exit(0);
