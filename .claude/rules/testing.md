# Testing — do this before saying something works

1. `node tools/check.js` loads every script in one scope and catches syntax and top-level errors.
2. `tools/shot.sh out.png 'demo&...'` takes a headless Firefox screenshot. Then **look at it**.
   Runtime errors are printed on the page. Firefox hides `file://` error details, so the frame
   loop catches exceptions and shows the stack.
   Useful hashes (full list in README "Testing hook"):
   `demo&at=bx,by&look=tx,ty` (frame a block), `time=2` (night), `drive=60`, `mission=torch`,
   `tank=0.5`, `phone=gps`, `rampage=6,4`, `mouse=x,y`, `shoot=120`, `map`.
3. For art, check `gallery.html`: `SHOT_SIZE=1400,9000 tools/shot.sh g.png '' gallery.html`.

Headless screenshots can't show how things *feel* or *sound*. For controls, handling, balance
or audio, say plainly that it hasn't been play-tested or listened to.
