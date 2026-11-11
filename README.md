# Sent in Threads (Enviados en hilos)

A Thunderbird add-on that makes your **own sent replies show up inside the
conversation threads** of the folder where the conversation lives (usually the
Inbox), instead of only in the *Sent* folder.

Thunderbird threads only the messages stored in the folder you are viewing, so
your replies, which are filed in *Sent*, never appear in the Inbox threads. This
add-on puts a copy of each sent reply next to the conversation. The original
stays in *Sent*.

## Features

- **Automatic:** when you send a reply, a copy goes to the folder(s) that
  hold the message you replied to. If you replied to one of your own messages,
  it walks up the `References` chain until it finds a regular folder.
- **One thread:** right-click a message → *Add my sent replies to this thread*.
- **Whole folder:** right-click a folder → *Add my sent replies to this
  folder's threads*. It scans sent messages from the last *N* days (90 by
  default, configurable in the add-on options).
- It never creates duplicates: a message whose `Message-ID` is already in the
  target folder is skipped.
- It never copies into Sent, Drafts, Templates, Outbox, Trash, Junk, unified or
  virtual folders.

## How sent replies are matched

A sent message belongs to a thread in folder *F* when its `In-Reply-To` or
`References` header contains the `Message-ID` of a message in *F*. To keep the
manual scans fast, only sent messages whose subject (minus `Re:`, `Fwd:`, `RV:`…)
matches a subject in *F* are inspected. Replies where you changed the subject
are only caught by the automatic mode.

## Notes

- Only messages sent with *Send now* are handled automatically. Messages
  queued with *Send later* can be added afterwards with the context-menu
  actions.
- With Gmail over IMAP, copying a message to the Inbox just adds the *Inbox*
  label to it. It does not create a second message.
- Thunderbird also has a built-in per-identity option, *Account Settings →
  Copies & Folders → Place replies in the folder of the message being replied
  to*. It *moves* the reply out of *Sent*. This add-on *copies* it, so *Sent*
  stays complete, and it can also fix older conversations.

## Install

Requires Thunderbird 128 or later. Tested target: Thunderbird 158.

```sh
./build.sh          # creates dist/sent-in-threads-<version>.xpi
```

Then in Thunderbird: *Tools → Add-ons and Themes → ⚙ → Install Add-on From
File…* and pick the `.xpi`.

For development, use *⚙ → Debug Add-ons → Load Temporary Add-on…* and pick
`src/manifest.json`.

## License

MIT
