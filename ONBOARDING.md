# Joey — Better iMessage for Mac

## What is this?

Joey is a **local web app that makes texting less chaotic**. If you're someone who gets lots of messages and finds yourself losing track of what actually needs a response, this is for you.

Built by Rich to solve the problem of iMessage not being designed for high-volume texting — messages get lost, you can't archive, and there's no way to know which ones actually need action.

## What's the vibe?

- **AI autodrafting** — paste a message thread, hit a button, and Joey drafts a reply that sounds like *you*. You edit it once, and it learns your voice for next time.
- **Smart triage** — conversations are sorted by urgency: questions and plans float to the top, everything else goes below so nothing gets buried.
- **Archive to inbox zero** — archive conversations you're done with. They reappear automatically the instant someone replies.

All of this happens **locally on your Mac**. Your message history never leaves your computer — the only thing that goes to the internet is the optional Claude API call for drafting (and you can turn that off).

## Why use this?

If you're tired of:
- Missing important messages because your inbox is 200 deep
- Saying "I'll respond to that later" and never finding it again
- Taking forever to write casual replies
- Having no good way to manage conversations you're not actively in

...this fixes that.

## How do I try it?

1. **Clone the repo** — get the code on your Mac
2. **Grant permissions** — the app needs to read from your Messages database, so macOS will ask for Full Disk Access (totally safe, it's read-only)
3. **Run it** — start the server with `npm start` and open it in your browser
4. **(Optional) Add your Claude API key** — if you want the AI features, drop in an API key. It's optional; everything else works without it.

For detailed setup instructions, check the README.

## The philosophy

- **Private.** Everything is local-first. The only external call is to Claude, and only if you enable it.
- **Learnable.** Joey gets better at your voice over time as you edit drafts.
- **Humble.** It's not trying to replace Messages — just give you the tools Messages doesn't have.

## Getting started

See **README.md** for full setup instructions. If you hit any snags or have questions, reach out to Rich.

---

Made with ✓ for people drowning in texts. 📱
