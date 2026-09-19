# aIVplayer

A music player for two PCs, built to reproduce the three-speaker arrangement Brian Eno described
in the sleeve notes to *Ambient 4: On Land*.

Alongside your usual stereo pair, a third speaker behind the listening position carries the
**difference** between the left and right channels — the part of the recording that isn't common to
both. Eno's original suggestion was to wire that third speaker across the two positive amplifier
terminals, which produces L−R passively. aIVplayer does the same thing in software, which means the
rear channel can be delayed, attenuated and switched between modes instead of being fixed by the
wiring.

The effect is worth hearing. Reverb tails, room ambience and anything panned wide move behind you,
while anything centred — which is most of the direct sound — cancels out and stays in front.

## How it works

One PC is the **front**. It holds the music, decodes it, plays the normal stereo mix, and runs a
small hub that the other PC connects to over your LAN.

The other PC is the **rear**. It receives audio from the front and plays only the difference signal
through the speaker behind you.

The two find each other automatically with a UDP broadcast, and stay sample-aligned using an
NTP-style clock exchange and a drift controller that continuously retunes the rear's playback rate.
Either PC can control playback — play, pause, skip and the ambience settings all work from either
end.

## Rear channel modes

| Mode | What the rear speaker plays |
| --- | --- |
| **Difference** | `L − R`. The Eno arrangement. |
| **Wide** | The difference signal with extra gain, for a more pronounced effect. |
| **Single** | One channel on its own, matching the original sleeve-note diagram. |

Rear gain and a delay of 0–50 ms are adjustable, so you can time-align the rear speaker to its
extra distance from the listening position.

## Requirements

- Two PCs on the same network — wired Ethernet is best, Wi-Fi works but adds timing jitter
- Windows 10/11, or Linux
- A stereo pair on the front PC, and at least one speaker on the rear

## Installing

Download the latest build from [Releases](https://github.com/wrightmt/aivplayer/releases) and run
it on **both** PCs.

**Windows** — unzip anywhere and run `aIVplayer.exe`. The app is not code signed, so SmartScreen
will warn you; choose *More info* → *Run anyway*. Allow it through Windows Firewall on **Private**
networks when prompted.

**Linux** — `chmod +x aIVplayer-*.AppImage && ./aIVplayer-*.AppImage`. If FUSE isn't available, use
`--appimage-extract-and-run`, or take the `.tar.gz` and run the `aIVplayer` binary inside.

## First run

1. Each PC asks whether it is the **front** or the **rear**. Pick one of each.
2. On the front, open Settings and choose the folder holding your music.
3. The rear finds the front by itself. The first time it connects, the front asks
   **"<name> wants to connect — Allow / Deny"**. Click Allow once; it is remembered from then on.

If the rear says it can't find a front, it's almost always the firewall. The front needs
**TCP 47811** and **UDP 47810** open. On Linux with ufw:

```bash
sudo ufw allow 47810/udp comment 'aIVplayer discovery'
sudo ufw allow 47811/tcp comment 'aIVplayer hub'
```

Watch the protocols there — the beacon is UDP and the hub is TCP. Opening 47811 as UDP produces the
most confusing failure this app has: the rear discovers the front by name and then sits on
"Connecting…" forever.

## Supported formats

**FLAC, MP3 and WAV**, scanned recursively from your music folder, with tags, cover art and
duration read from the files.

The list is deliberately limited to what the player can actually decode. `.m4a` is excluded on
purpose — AAC inside one would play but ALAC would not, so such files would appear in the library
and then fail when you tried to play them.

## Sync

Settings → Sync reports live sync error, the correction being applied in ppm, buffer depth, round
trip time, output-timestamp jitter, underruns and resyncs.

**Timestamp jitter is the number that matters.** It measures how precisely each machine's sound card
reports when audio actually left the speakers. If it is more than a few milliseconds, that driver —
not the network — sets the limit on how tightly the two PCs can be aligned.

## Where settings live

- **Windows:** `%APPDATA%\aivplayer\`
- **Linux:** `~/.config/aivplayer/`

`settings.json` holds this PC's role, output device, library folder and ports. On the front,
`paired.json` lists the rear PCs you've allowed. Delete `settings.json` to return to the first-run
role picker.

## Privacy and security

aIVplayer talks only to the other PC on your network. There is no telemetry, no account, no cloud
service and no outbound connection of any kind.

The front only accepts a remote PC after you allow it, and only the PC running the hub can act as
the front. Browser-based connections from other origins are refused, so a web page on your network
cannot reach the hub.

## Building from source

```bash
npm install
npm test          # 113 tests
npm run check     # typecheck + svelte-check
npm run dev

npm run dist:win    # Windows zip
npm run dist:linux  # AppImage + tar.gz
```

The app icon is generated, not hand-drawn — `python3 tools/make-icon.py build/icon.png 1024`
renders it from signed distance fields, so it can be adjusted by editing the constants at the top
of that script.

## Licence

[MIT](LICENSE). Use it however you like.

Not affiliated with or endorsed by Brian Eno. *Ambient 4: On Land* is referenced only to describe
the listening arrangement this player reproduces.
