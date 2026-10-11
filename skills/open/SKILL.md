---
name: open
description: Open a local HTML document in ubiqdoc, a reader where you drag any phrase and ask the AI about it on the spot; answers are written back into the document as popovers, child sections or links. Starts the local server if it is not running. Use for "open this in ubiqdoc", "I want to read this doc with AI", "read this spec and let me ask about terms", 「ubiqdoc で開いて」「この資料を読みながら AI に聞きたい」「ドキュメントリーダーを起動して」. Also use to stop the server ("stop ubiqdoc").
---

# Open a document in ubiqdoc

ubiqdoc is a small local web app (`server.js`, no dependencies, Node 18+). It runs on
`http://127.0.0.1:8910/` and calls the `claude` CLI for every question, so the user must already be
logged in to Claude Code. It only accepts requests from this machine.

By default this skill opens documents as a **copy** in the data folder, and the copy is what gets
annotated. Writing into the original file is opt-in (see step 2).

Use the same data folder every time so the list of opened documents survives plugin updates:
`${CLAUDE_PLUGIN_DATA}/data`.

## 1. Make sure the server is running

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8910/
```

If that prints `200`, it is already running — use it. Otherwise start it in the background.
Set the port with `UBIQDOC_PORT`, not `PORT` (a `PORT` leaking in from another tool's environment
would move the server elsewhere):

```bash
mkdir -p "${CLAUDE_PLUGIN_DATA}/data"
UBIQDOC_PORT=8910 UBIQDOC_DATA_DIR="${CLAUDE_PLUGIN_DATA}/data" \
  nohup node "${CLAUDE_PLUGIN_ROOT}/server.js" > "${CLAUDE_PLUGIN_DATA}/server.log" 2>&1 &
sleep 1; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8910/
```

If it still does not answer, show the last lines of `${CLAUDE_PLUGIN_DATA}/server.log`. If 8910 is
held by something else, start with another `UBIQDOC_PORT` and use that port everywhere below.

## 2. Open the document

Only HTML files are supported. Use an **absolute** path. If the user gave a Markdown file, say so
and stop — do not convert it silently.

Open it in the browser with the `?open=` entry point. **Add `inPlace=0` unless the user asked to
write into the original file** — with `inPlace=0` the annotations go into a copy and the original
is never touched. Without it, ubiqdoc writes into the file itself (undo still works, but only
recommend that for files under git or otherwise recoverable).

```bash
P=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "/abs/path/to/doc.html")
open "http://127.0.0.1:8910/?open=$P&inPlace=0"        # macOS (xdg-open on Linux)
```

Opening the same file again reuses the document opened before (the page says so). With no file
given, just open `http://127.0.0.1:8910/` — the user can paste a path there, or pick a document
opened before from the list at the top.

## 3. Tell the user how to use it

Keep it to a few lines:

- Drag a phrase → a small chat window opens there. The buttons pick how the answer is written:
  popover / section / link. Several windows can wait for answers at once.
- Click the page background to close the windows. Answers still arriving are written anyway.
- The right pane undoes a question's writes, converts popover ↔ section, and approves rewrites.
- The first question waits for the AI to finish reading the document (top right says
  "準備完了" when ready). The default model is Haiku; change it at the top right.

## Stopping the server

```bash
lsof -ti tcp:8910 -sTCP:LISTEN | xargs kill
```

Only stop it if the user asks. Annotated documents stay in `${CLAUDE_PLUGIN_DATA}/data`.
