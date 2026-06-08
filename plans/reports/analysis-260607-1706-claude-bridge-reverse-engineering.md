# Claude Bridge — Reverse-Engineering Analysis

> Phân tích sản phẩm "Claude Bridge by Transform Group" (demo từ FB Nguyen Ngoc Tuan, event 29/5 HCM)
> Đối chiếu trực tiếp với source `lark-cli` repo này. Date: 2026-06-07.

## TL;DR

Bridge = **control plane đa-tenant** bọc quanh 3 thứ đã có sẵn trong repo: event-bus (WebSocket), sidecar auth (multi-tenant HMAC), và Claude Code CLI làm engine (OAuth, không API key). Tác giả Bridge **chính là tác giả repo** (Transform Group). ~70% nền tảng đã nằm trong repo dưới dạng `event consume` + `sidecar/server-multi-tenant-demo` + `cmd/auth/qrcode`. Phần thương mại thêm: quota/cost governance, project binding UI, Next.js dashboard.

## Kiến trúc suy ra (có căn cứ source)

```
  Lark/Feishu cloud
        │  WebSocket long-conn (internal/event/source/feishu.go → "feishu-websocket")
        ▼
  ┌─────────────────────────────────────────────┐
  │  BRIDGE (control plane, :9820)              │
  │                                             │
  │  event bus daemon ──► msg router            │  ← cmd/event/bus.go (forked daemon)
  │       │                  │                  │
  │       │            session store (chat_id)  │  ← memory per chat = Claude --resume
  │       ▼                  ▼                  │
  │  sidecar (multi-tenant) ─► Claude Code CLI  │  ← sidecar/server-multi-tenant-demo
  │   HMAC per-user            (OAuth engine)   │     + Claude CLI OAuth
  │   inject user token        + lark-cli MCP   │  ← 21 MCP tools (mcp serve)
  │       │                       │             │
  │  quota/cost meter ◄───────────┘             │  ← token→$, cohort, audit (Bridge-only)
  │  Next.js dashboard ◄── SQLite/audit log     │
  └─────────────────────────────────────────────┘
        │ reply
        ▼  lark_im_send / im send
  Lark chat
```

## Tầng đối chiếu source

| Tầng | Bằng chứng trong repo | Bridge thêm |
|---|---|---|
| **Nhận event** | `internal/event/source/feishu.go` = `"feishu-websocket"`; `cmd/event/consume.go` NDJSON stream; bus daemon forked `cmd/event/bus.go` | Service-hóa, route theo project/app |
| **WS long-conn** | `internal/event/consume/remote_preflight.go` "active WebSocket connections" | → **Không cần public webhook URL** → localhost:9820 chạy được |
| **Auth QR self-service** | `cmd/auth/qrcode.go`, `login.go` device-flow `--no-wait`/`--device-code`, `sidecar/.../auth_bridge.go` "login/poll/status" | Bọc web modal "scan QR" |
| **Multi-tenant isolation** | `sidecar/server-multi-tenant-demo/README.md` — dual-key HMAC, app_secret chỉ ở trusted host, per-client `.key` inject đúng user token | UI "Projects" = 1 app→1 instance |
| **Engine OAuth** | Provider tag `claudecode`; Claude Code CLI dùng `~/.claude/.credentials.json` khi không có `ANTHROPIC_API_KEY` | Pool/queue "agent runs in flight" |
| **Tools** | `cmd/mcp/` serve = 21 tools (im/mail/calendar/doc/base/task/sheets/vc/okr/drive/contact + `lark_api`) | Agent tự chọn tool |
| **Memory per chat_id** | Claude session resume (CLI `--resume`/`--continue`) | Map chat_id ↔ session id |
| **Audit** | `sidecar/.../audit.go`, `cmd/mcp/audit.go` newSessionID | Web "Audit" tab, per-msg log |
| **Quota/cost** | ❌ KHÔNG có trong repo | **Lõi giá trị thương mại** |
| **Dashboard** | ❌ | Next.js @ :9820 |

## Cost model — điểm kỹ thuật đáng học nhất

- Demo: **20 msg = $0.11–0.14**, cache hit **83%**, "cached tokens cost 10× less".
- Lý do build trên Claude **CLI** chứ không API trần: CLI tự **prompt-cache** phần tĩnh (`CLAUDE.md` + skills `.md` — lặp lại mọi message) → ~83% input gần free.
- Triết lý FB post: *"Agent xây hoàn toàn bằng file .md, không lệ thuộc tool/workflow"* → mỗi agent = 1 thư mục `CLAUDE.md`+skills, giống hệt `.claude/` repo này. Đổi agent = đổi folder, không code lại.

## Governance layer (phần Bridge bán thêm)

Từ screenshots Insights/Quota/Dashboard:
- **Cohort phân loại user**: power / spam-prone / stuck / dormant / normal — chấm điểm theo volume×score.
- **Quota auto-tighten**: tự siết cap khi user spam ("quota auto-tightened").
- **Risk score**, "stuck users → /help nudge", "highest spenders today".
- **Cron**: scheduled agent runs.
- **Skills toggle**: bật/tắt `.md` skill per project.

→ Đây là lớp **measure + control + bill** mà CLI thuần không có. Giá trị: cho org giới hạn user, đo quota, phân quyền — đúng pain points FB post nêu.

## Khoảng cách để tự build (nếu sau này muốn)

Đã có sẵn (repo): event nhận, reply, OAuth engine, QR auth, multi-tenant sidecar, 21 tools, MCP.
Phải tự viết:
1. **Glue loop**: `event consume im.message.receive_v1` → spawn Claude (resume theo chat_id) → `im send`. (~150 dòng, hướng C)
2. **Session store**: map `chat_id` ↔ Claude session id (file/SQLite).
3. **Quota/cost meter**: parse token usage từ Claude CLI output → quy đổi $ → cap per user. (phần khó nhất)
4. **Dashboard** (optional): Next.js đọc audit log.

## Điều kiện vận hành (đã xác nhận)

- Lark events qua **WS long-conn** → KHÔNG cần expose port ra internet. Chạy local OK.
- App phải bật event `im.message.receive_v1` trong Developer Console.
- Engine OAuth: cần Claude Code đã login (`~/.claude/.credentials.json`) → tiêu quota subscription, không phải API.
- Scope `im:message` đã có trong app hiện tại (`cli_a9707ccfdea25ed1`).

## Unresolved questions

1. Bridge có release source/binary công khai không, hay chỉ demo tại event? (quyết định: dùng vs tự build)
2. Quota meter của Bridge đọc cost từ đâu — Claude CLI có expose token usage per-run dạng JSON không? Cần verify `claude -p --output-format json` có field `usage`/`cost`.
3. Session resume per chat_id: Bridge dùng Claude CLI `--resume <session-id>` hay tự nối context qua file? Ảnh hưởng cách build memory.
4. Multi-app: Bridge chạy 1 sidecar instance/port mỗi app (như demo) hay 1 process route nhiều app?
