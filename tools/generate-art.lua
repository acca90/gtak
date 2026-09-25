-- Pastel City — procedural seed art for Aseprite.
--
-- Builds every sprite sheet of the game as an editable .aseprite file in art/.
-- Each sheet is one sprite whose frames are the sprite images and whose tags
-- name them; tools/export-art.lua turns them into assets/*.png + atlas.js.
--
-- Existing files are NOT overwritten unless --script-param force=1 is passed,
-- so hand edits made in Aseprite survive a re-run.
--
--   aseprite -b --script-param root=$PWD --script tools/generate-art.lua

local root = app.params.root or app.fs.currentPath
local force = app.params.force == "1"
local ART = app.fs.joinPath(root, "art")
app.fs.makeAllDirectories(ART)

local pc = app.pixelColor

-- ---------------------------------------------------------------- palette --
-- One char per colour so pixel art can be written as strings.
local PALETTE = {
  {"K","1a1c2c"},{"k","2b2d42"},{"d","4f5168"},{"m","7f8198"},{"l","b8b8c8"},{"x","f2efe6"},
  {"a","3b3f58"},{"A","464b66"},{"b","565c7a"},
  {"s","9c8b75"},{"S","b5a288"},{"t","c9b79c"},{"T","e0d2b8"},
  {"g","2a5446"},{"G","3f7d5c"},{"h","58a06f"},{"H","86c28a"},
  {"w","24466a"},{"W","32658c"},{"v","5aa3c4"},{"V","a8dcea"},
  {"e","2f5d62"},{"E","3f7f7a"},{"f","5fa39a"},{"F","9fd4c4"},
  {"r","8e3b53"},{"R","d06a6a"},{"p","f29b88"},{"P","b48ac4"},
  {"u","5b3f73"},{"U","8a5a9e"},
  {"y","e8a33b"},{"Y","f4d58d"},{"c","fff1c9"},{"O","e07a3f"},{"L","f2c14e"},
  {"n","6b4432"},{"N","8f5e3e"},{"o","c08e5e"},
  {"i","e8e4d8"},{"j","ffe9a0"},{"z","ff5f7e"},{"q","54e8d4"},{"B","2c5a8c"},{"C","7fb0e0"},
}
local C = {}
for _, e in ipairs(PALETTE) do
  local h = e[2]
  C[e[1]] = pc.rgba(tonumber(h:sub(1,2),16), tonumber(h:sub(3,4),16), tonumber(h:sub(5,6),16), 255)
end
C.white = pc.rgba(255,255,255,255)
local CLEAR = pc.rgba(0,0,0,0)

math.randomseed(20260925)
local function R(a, b) if a then return math.random(a, b) end return math.random() end

-- ---------------------------------------------------------------- helpers --
local function img(w, h) return Image(w, h, ColorMode.RGB) end
local function col(c) if type(c) == "string" then return C[c] end return c end
local function px(im, x, y, c)
  x, y = math.floor(x), math.floor(y)
  if x >= 0 and y >= 0 and x < im.width and y < im.height then im:drawPixel(x, y, col(c)) end
end
local function get(im, x, y)
  if x < 0 or y < 0 or x >= im.width or y >= im.height then return CLEAR end
  return im:getPixel(x, y)
end
local function opaque(im, x, y) return pc.rgbaA(get(im, x, y)) > 0 end
local function rect(im, x, y, w, h, c) for j = y, y+h-1 do for i = x, x+w-1 do px(im, i, j, c) end end end
local function fill(im, c) rect(im, 0, 0, im.width, im.height, c) end
local function copy(im) local n = img(im.width, im.height); n:drawImage(im, Point(0,0)); return n end

-- Draw rows of chars; '.' and ' ' are transparent. map overrides palette chars.
local function art(im, ox, oy, rows, map)
  for j, row in ipairs(rows) do
    for i = 1, #row do
      local ch = row:sub(i, i)
      if ch ~= "." and ch ~= " " then
        local c = (map and map[ch]) or C[ch]
        if c then px(im, ox+i-1, oy+j-1, c) end
      end
    end
  end
end

local BAYER = {{0,8,2,10},{12,4,14,6},{3,11,1,9},{15,7,13,5}}
local function dith(x, y) return (BAYER[(y % 4) + 1][(x % 4) + 1] + 0.5) / 16 end

-- pick a colour from a dark->light ramp for value v in [0,1], ordered-dithered
local function ramp(list, v, x, y)
  local n = #list
  local f = math.max(0, math.min(1, v)) * (n - 1)
  local i = math.floor(f)
  if f - i > dith(x, y) then i = i + 1 end
  return col(list[math.max(0, math.min(n-1, i)) + 1])
end

-- shaded ellipse, lit from (lx,ly) (top-left by default)
local function blob(im, cx, cy, rx, ry, list, noise, lx, ly)
  lx, ly = lx or -0.6, ly or -0.8
  for y = math.floor(cy-ry-1), math.ceil(cy+ry+1) do
    for x = math.floor(cx-rx-1), math.ceil(cx+rx+1) do
      local dx, dy = (x+0.5-cx)/rx, (y+0.5-cy)/ry
      local d2 = dx*dx + dy*dy
      if d2 <= 1 then
        local dz = math.sqrt(1 - d2)
        local l = dx*lx + dy*ly + dz*0.6
        local v = l*0.55 + 0.35 + (noise and (R()-0.5)*noise or 0)
        px(im, x, y, ramp(list, v, x, y))
      end
    end
  end
end
local function sphere(im, cx, cy, r, list, noise) blob(im, cx, cy, r, r, list, noise) end

local function disc(im, cx, cy, r, c)
  for y = math.floor(cy-r-1), math.ceil(cy+r+1) do
    for x = math.floor(cx-r-1), math.ceil(cx+r+1) do
      local dx, dy = x+0.5-cx, y+0.5-cy
      if dx*dx + dy*dy <= r*r then px(im, x, y, c) end
    end
  end
end
local function ring(im, cx, cy, r0, r1, c)
  for y = math.floor(cy-r1-1), math.ceil(cy+r1+1) do
    for x = math.floor(cx-r1-1), math.ceil(cx+r1+1) do
      local dx, dy = x+0.5-cx, y+0.5-cy
      local d = math.sqrt(dx*dx + dy*dy)
      if d >= r0 and d <= r1 then px(im, x, y, c) end
    end
  end
end

-- selective outline: transparent pixels touching opaque ones get colour c
local function outline(im, c)
  local marks = {}
  for y = 0, im.height-1 do
    for x = 0, im.width-1 do
      if not opaque(im, x, y) and (opaque(im,x+1,y) or opaque(im,x-1,y) or opaque(im,x,y+1) or opaque(im,x,y-1)) then
        marks[#marks+1] = {x, y}
      end
    end
  end
  for _, m in ipairs(marks) do px(im, m[1], m[2], c) end
end

-- ------------------------------------------------------------------ sheets --
local function sheet(name, w, h) return {name=name, w=w, h=h, frames={}, tags={}} end
local function add(sh, tag, frames, ms)
  local from = #sh.frames + 1
  for _, f in ipairs(frames) do sh.frames[#sh.frames+1] = {img=f, ms=ms or 100} end
  sh.tags[#sh.tags+1] = {name=tag, from=from, to=#sh.frames}
end

local function save(sh)
  local path = app.fs.joinPath(ART, sh.name .. ".aseprite")
  if app.fs.isFile(path) and not force then
    print("keep   " .. sh.name .. ".aseprite (exists; pass force=1 to regenerate)")
    return
  end
  local spr = Sprite(sh.w, sh.h, ColorMode.RGB)
  local pal = Palette(#PALETTE)
  for i, e in ipairs(PALETTE) do
    local h = e[2]
    pal:setColor(i-1, Color{r=tonumber(h:sub(1,2),16), g=tonumber(h:sub(3,4),16), b=tonumber(h:sub(5,6),16)})
  end
  spr:setPalette(pal)
  spr.layers[1].name = sh.name
  for i, f in ipairs(sh.frames) do
    if i > 1 then spr:newEmptyFrame() end
    spr:newCel(spr.layers[1], i, f.img, Point(0, 0))
    spr.frames[i].duration = f.ms / 1000
  end
  for _, t in ipairs(sh.tags) do
    local tg = spr:newTag(t.from, t.to)
    tg.name = t.name
  end
  spr:saveAs(path)
  spr:close()
  print(string.format("wrote  %s.aseprite  %dx%d  %d frames  %d tags", sh.name, sh.w, sh.h, #sh.frames, #sh.tags))
end

-- ================================================================== TILES ==
local tiles = sheet("tiles", 16, 16)

local function asphalt(im, base, speck)
  base = base or "A"
  fill(im, base)
  for y = 0, 15 do
    for x = 0, 15 do
      local r = R()
      if r < (speck or 0.07) then px(im, x, y, "a")
      elseif r < (speck or 0.07) * 1.6 then px(im, x, y, "b") end
    end
  end
  -- a few 2px grit clusters
  for _ = 1, 2 do local x, y = R(0,14), R(0,14); px(im,x,y,"a"); px(im,x+1,y,"a") end
end

local function newAsphalt() local im = img(16,16); asphalt(im); return im end
add(tiles, "asphalt", {newAsphalt(), newAsphalt(), newAsphalt()})

local function centerLine(vertical, pos)
  local im = newAsphalt()
  for i = 0, 15 do
    local c = (R() < 0.08) and "y" or "L"
    if vertical then px(im, pos, i, c) else px(im, i, pos, c) end
  end
  return im
end
add(tiles, "line_v_l", {centerLine(true, 14)})
add(tiles, "line_v_r", {centerLine(true, 1)})
add(tiles, "line_h_t", {centerLine(false, 14)})
add(tiles, "line_h_b", {centerLine(false, 1)})
-- double line centred in one tile (odd-width roads)
local function centerLineC(vertical)
  local im = newAsphalt()
  for i = 0, 15 do
    for _, pos in ipairs({6, 9}) do
      local c = (R() < 0.08) and "y" or "L"
      if vertical then px(im, pos, i, c) else px(im, i, pos, c) end
    end
  end
  return im
end
add(tiles, "line_v_c", {centerLineC(true)})
add(tiles, "line_h_c", {centerLineC(false)})

local function zebra(vertical, from, to)
  local im = newAsphalt()
  for a = 0, 15 do
    if (a % 8) >= 2 and (a % 8) <= 5 then
      for b = from, to do
        local c = (R() < 0.1) and "l" or "i"
        if vertical then px(im, a, b, c) else px(im, b, a, c) end
      end
    end
  end
  return im
end
add(tiles, "zebra_v", {zebra(true, 3, 15), zebra(true, 0, 12)})
add(tiles, "zebra_h", {zebra(false, 3, 15), zebra(false, 0, 12)})

do
  local im = newAsphalt()
  disc(im, 8, 8, 5, "a")
  disc(im, 8, 8, 4, "d")
  for i = 5, 11, 2 do for j = 5, 11 do px(im, i, j, "a") end end
  px(im, 6, 5, "m"); px(im, 5, 6, "m")
  add(tiles, "manhole", {im})
end

-- sidewalk: 16 frames indexed by a curb mask (n=1 e=2 s=4 w=8)
local function paving(im)
  for y = 0, 15 do
    for x = 0, 15 do
      local cx, cy = x % 8, y % 8
      local c = "t"
      if cx == 7 or cy == 7 then c = "s" elseif cx == 0 or cy == 0 then c = "T" end
      px(im, x, y, c)
    end
  end
  for py = 0, 1 do for pxx = 0, 1 do
    if R() < 0.3 then rect(im, pxx*8+1, py*8+1, 6, 6, "S") end
  end end
  for _ = 1, 3 do px(im, R(0,15), R(0,15), "s") end
end
local function curb(im, side)
  for i = 0, 15 do
    if side == "n" then px(im,i,0,"m"); px(im,i,1,"x"); px(im,i,2,"l")
    elseif side == "s" then px(im,i,15,"d"); px(im,i,14,"l"); px(im,i,13,"x")
    elseif side == "w" then px(im,0,i,"m"); px(im,1,i,"x"); px(im,2,i,"l")
    elseif side == "e" then px(im,15,i,"d"); px(im,14,i,"l"); px(im,13,i,"x") end
  end
end
do
  local frames = {}
  for mask = 0, 15 do
    local im = img(16,16)
    paving(im)
    if mask & 1 ~= 0 then curb(im, "n") end
    if mask & 2 ~= 0 then curb(im, "e") end
    if mask & 4 ~= 0 then curb(im, "s") end
    if mask & 8 ~= 0 then curb(im, "w") end
    frames[#frames+1] = im
  end
  add(tiles, "walk", frames)
end

local function grass(flowers)
  local im = img(16,16)
  fill(im, "G")
  for _ = 1, 14 do local x, y = R(0,15), R(1,15); px(im,x,y,"h"); px(im,x,y-1,"H") end
  for _ = 1, 10 do px(im, R(0,15), R(0,15), "g") end
  if flowers then
    for _ = 1, 4 do
      local x, y = R(1,14), R(1,14)
      local pet = (R() < 0.5) and "p" or "x"
      px(im,x-1,y,pet); px(im,x+1,y,pet); px(im,x,y-1,pet); px(im,x,y+1,pet); px(im,x,y,"Y")
    end
  end
  return im
end
add(tiles, "grass", {grass(), grass(), grass()})
add(tiles, "flowers", {grass(true)})

local function gravel()
  local im = img(16,16)
  fill(im, "o")
  for y = 0, 15 do for x = 0, 15 do
    local r = R()
    if r < 0.12 then px(im,x,y,"N") elseif r < 0.2 then px(im,x,y,"Y") end
  end end
  return im
end
add(tiles, "path", {gravel(), gravel()})

do -- water, 4-frame loop: dashes travel 4px per frame on a 16px period
  local frames = {}
  for f = 0, 3 do
    local im = img(16,16)
    fill(im, "W")
    for _, y in ipairs({1, 5, 9, 13}) do
      local s = (y*3 + (y//4)*5 + f*4) % 16
      for k = 0, 3 do px(im, (s+k) % 16, y, "v") end
      for k = 1, 4 do px(im, (s+k) % 16, y+1, "w") end
    end
    local sx, sy = (f*5 + 3) % 16, (f*7 + 3) % 16
    if f % 2 == 0 then px(im, sx, sy, "V") end
    frames[#frames+1] = im
  end
  add(tiles, "water", frames, 250)
end

local function plaza(a, b, hiA, hiB)
  local im = img(16,16)
  for y = 0, 15 do for x = 0, 15 do
    local even = ((x // 8) + (y // 8)) % 2 == 0
    local c = even and a or b
    local cx, cy = x % 8, y % 8
    if cx == 7 or cy == 7 then c = "s"
    elseif cx == 0 or cy == 0 then c = even and hiA or hiB end
    px(im, x, y, c)
  end end
  return im
end
add(tiles, "plaza", {plaza("p", "c", "c", "x"), plaza("f", "c", "F", "x")})

do
  local function lot()
    local im = img(16,16)
    asphalt(im, "A", 0.04)
    if R() < 0.5 then disc(im, R(4,11), R(4,11), 2.2, "a") end
    return im
  end
  add(tiles, "lot", {lot()})
  local im = lot(); for y = 0, 15 do px(im, 0, y, "i") end
  add(tiles, "lot_line", {im})
  im = lot(); for x = 0, 15 do px(im, x, 15, "i") end
  add(tiles, "lot_hline", {im})
end

-- ------------------------------------------------------ region tiles --
-- transpose a tile (for vertical versions of horizontal patterns)
local function transpose(im)
  local t = img(im.height, im.width)
  for y = 0, im.height - 1 do for x = 0, im.width - 1 do t:drawPixel(y, x, im:getPixel(x, y)) end end
  return t
end

-- country roads: single dashed centre line, no crossings
do
  local im = newAsphalt()
  for y = 0, 7 do px(im, 7, y, "L"); px(im, 8, y, "L") end
  add(tiles, "line_v_d", {im})
  add(tiles, "line_h_d", {transpose(im)})
end

-- railway. A horizontal track spans two tile rows: frame 0 is the upper rail,
-- frame 1 the lower one (14px gauge). Sleepers repeat every 8px.
local function ballast(im)
  fill(im, "m")
  for y = 0, 15 do for x = 0, 15 do
    local r = R()
    if r < 0.25 then px(im, x, y, "l") elseif r < 0.42 then px(im, x, y, "d") end
  end end
end
local function railTile(which, crossing)
  local im = img(16, 16)
  if crossing then asphalt(im) else ballast(im) end
  local s0, s1, rail = 9, 15, 12
  if which == 1 then s0, s1, rail = 0, 12, 10 end
  if crossing then
    rect(im, 0, which == 0 and 11 or 0, 16, which == 0 and 5 or 13, "k")
  else
    for x = 0, 15 do
      if x % 8 >= 1 and x % 8 <= 3 then
        for y = s0, s1 do px(im, x, y, (x % 8 == 1) and "o" or "N") end
      end
    end
  end
  for x = 0, 15 do px(im, x, rail, "x"); px(im, x, rail + 1, "d") end
  return im
end
do
  local a, b = railTile(0), railTile(1)
  add(tiles, "rail_h", {a, b})
  add(tiles, "rail_v", {transpose(a), transpose(b)})
  local xa, xb = railTile(0, true), railTile(1, true)
  add(tiles, "rail_x_h", {xa, xb})
  add(tiles, "rail_x_v", {transpose(xa), transpose(xb)})
  local g = img(16, 16); ballast(g); add(tiles, "ballast", {g})
end

-- crops and farm ground (rows run horizontally; fields pick a frame per row)
local function crop(kind)
  local im = img(16, 16)
  for y = 0, 15 do for x = 0, 15 do
    local c
    if kind == "wheat" then
      c = (y % 4 == 3) and "y" or "Y"
      local r = R()
      if y % 4 ~= 3 and r < 0.12 then c = "c" elseif r < 0.2 then c = "L" end
    elseif kind == "corn" then
      local m = y % 5
      c = (m == 4) and "n" or ((m == 0) and "h" or "G")
      if m ~= 4 and R() < 0.15 then c = "H" end
    elseif kind == "soil" then
      local m = y % 3
      c = (m == 0) and "n" or ((m == 1) and "N" or "o")
      if R() < 0.06 then c = "n" end
    elseif kind == "pasture" then
      local r = R()
      c = (r < 0.12) and "H" or ((r < 0.2) and "G" or "h")
    elseif kind == "dirt" then
      local r = R()
      c = (r < 0.14) and "N" or ((r < 0.22) and "Y" or "o")
    elseif kind == "verge" then
      local r = R()
      c = (r < 0.18) and "o" or ((r < 0.3) and "h" or "G")
    elseif kind == "lawn" then
      c = "h"
      if (x // 8) % 2 == 1 and (x + y) % 2 == 0 then c = "G" end   -- soft mowing stripes
      if R() < 0.06 then c = "H" end
    elseif kind == "concrete" then
      c = "l"
      if x == 15 or y == 15 then c = "m" elseif x == 0 or y == 0 then c = "x" end
      if R() < 0.05 then c = "m" end
    elseif kind == "sand" then
      local r = R()
      c = (r < 0.15) and "S" or ((r < 0.25) and "T" or "t")
    end
    px(im, x, y, c)
  end end
  return im
end
add(tiles, "wheat", {crop("wheat"), crop("wheat")})
add(tiles, "corn", {crop("corn"), crop("corn")})
add(tiles, "soil", {crop("soil"), crop("soil")})
add(tiles, "pasture", {crop("pasture"), crop("pasture")})
add(tiles, "dirt", {crop("dirt"), crop("dirt")})
add(tiles, "verge", {crop("verge"), crop("verge")})
add(tiles, "lawn", {crop("lawn")})
do
  local a, b = crop("concrete"), crop("concrete")
  disc(b, R(4, 11), R(4, 11), 3, "m"); disc(b, R(4, 11), R(4, 11), 2, "d")
  add(tiles, "concrete", {a, b})
end
add(tiles, "sand", {crop("sand"), crop("sand")})

-- road bridge over water (horizontal road): north rail, deck, deck with line, south rail
do
  local function deck()
    local im = newAsphalt()
    for y = 0, 15 do px(im, 0, y, "a") end
    return im
  end
  local n = deck()
  rect(n, 0, 0, 16, 5, "d"); rect(n, 0, 1, 16, 2, "l"); rect(n, 0, 1, 16, 1, "x")
  for x = 0, 15, 4 do rect(n, x, 0, 2, 5, "K") end
  rect(n, 0, 5, 16, 1, "K")
  local s = deck()
  rect(s, 0, 11, 16, 5, "d"); rect(s, 0, 12, 16, 2, "l"); rect(s, 0, 12, 16, 1, "x")
  for x = 0, 15, 4 do rect(s, x, 11, 2, 5, "K") end
  rect(s, 0, 10, 16, 1, "m")
  local l = deck()
  for x = 0, 15 do px(l, x, 6, "L"); px(l, x, 9, "L") end
  add(tiles, "bridge", {n, deck(), l, s})
end

save(tiles)

-- ================================================================== ROOFS ==
local ROOF_STYLES = {
  {name="teal",  cap={"F","f","e"}, floor={"m","l","d"}, pat="gravel"},
  {name="rose",  cap={"p","R","r"}, floor={"l","x","m"}, pat="tiles"},
  {name="cream", cap={"c","Y","y"}, floor={"o","T","N"}, pat="gravel"},
  {name="plum",  cap={"P","U","u"}, floor={"A","b","a"}, pat="ribs"},
  {name="brick", cap={"o","N","n"}, floor={"d","m","k"}, pat="tar"},
  {name="mint",  cap={"H","h","G"}, floor={"h","H","G"}, pat="green"},
  -- regions
  {name="metal",  cap={"x","l","m"}, floor={"l","x","m"}, pat="ribs"},
  {name="rust",   cap={"o","N","n"}, floor={"N","o","n"}, pat="ribs"},
  {name="glass",  cap={"C","B","k"}, floor={"k","B","K"}, pat="grid"},
  {name="mall",   cap={"x","T","S"}, floor={"x","T","l"}, pat="skylight"},
  {name="deck",   cap={"l","m","d"}, floor={"A","b","a"}, pat="stalls"},
  {name="canopy", cap={"z","R","r"}, floor={"x","T","l"}, pat="plain"},
}

local roofs = sheet("roofs", 16, 16)

local function roofFloor(st, x, y)
  local f = st.floor
  if st.pat == "gravel" then
    local r = R(); return (r < 0.18) and f[2] or ((r < 0.28) and f[3] or f[1])
  elseif st.pat == "tiles" then
    if x % 4 == 3 or y % 4 == 3 then return f[3] end
    if x % 4 == 0 and y % 4 == 0 then return f[2] end
    return f[1]
  elseif st.pat == "ribs" then
    local m = x % 4; return (m == 0) and f[3] or ((m == 1) and f[2] or f[1])
  elseif st.pat == "tar" then
    local r = R(); return (r < 0.05) and f[2] or ((r < 0.08) and f[3] or f[1])
  elseif st.pat == "grid" then
    return (x % 8 == 7 or y % 8 == 7) and f[2] or f[1]
  elseif st.pat == "skylight" then
    local cx, cy = x % 8, y % 8
    if ((x // 8) + (y // 8)) % 2 == 0 and cx >= 2 and cx <= 5 and cy >= 2 and cy <= 5 then return (cx - cy == 0) and "V" or "C" end
    return (cx == 0 or cy == 0) and f[3] or f[1]
  elseif st.pat == "stalls" then
    if x % 16 == 0 then return "i" end
    return (R() < 0.06) and f[3] or f[1]
  elseif st.pat == "plain" then
    return (R() < 0.04) and f[2] or f[1]
  else -- green roof
    local r = R(); return (r < 0.2) and f[2] or ((r < 0.3) and f[3] or f[1])
  end
end

local function roofTile(st, top, right, bottom, left, variant)
  local im = img(16,16)
  for y = 0, 15 do
    for x = 0, 15 do
      local d, side = 99, nil
      if top and y < d then d, side = y, "t" end
      if left and x < d then d, side = x, "l" end
      if bottom and 15-y < d then d, side = 15-y, "b" end
      if right and 15-x < d then d, side = 15-x, "r" end
      local lit = (side == "t" or side == "l")
      local c
      if d == 0 then c = lit and st.cap[1] or st.cap[3]
      elseif d == 1 then c = st.cap[2]
      elseif d == 2 then c = lit and st.cap[3] or st.cap[1]
      else
        c = roofFloor(st, x, y)
        if d == 3 and lit then c = st.floor[3] end
      end
      px(im, x, y, c)
    end
  end
  if variant == 1 then -- drain
    rect(im, 6, 6, 4, 4, st.floor[3]); rect(im, 7, 7, 2, 2, "K")
  elseif variant == 2 then -- patched membrane
    local x0, y0 = R(2,6), R(2,6)
    for i = 0, 7 do px(im, x0+i, y0, st.floor[3]); px(im, x0+i, y0+5, st.floor[3]) end
    for j = 0, 5 do px(im, x0, y0+j, st.floor[3]); px(im, x0+7, y0+j, st.floor[3]) end
  end
  return im
end

for _, st in ipairs(ROOF_STYLES) do
  add(roofs, "roof_" .. st.name, {
    roofTile(st, true, false, false, true),  roofTile(st, true, false, false, false),  roofTile(st, true, true, false, false),
    roofTile(st, false, false, false, true), roofTile(st, false, false, false, false), roofTile(st, false, true, false, false),
    roofTile(st, false, false, true, true),  roofTile(st, false, false, true, false),  roofTile(st, false, true, true, false),
    roofTile(st, false, false, false, false, 1), roofTile(st, false, false, false, false, 2),
  })
end
save(roofs)

-- ------------------------------------------------------ pitched roofs --
-- Gable roofs with the ridge running horizontally, one tag per material.
-- 18 frames = 6 row types x 3 columns (left verge, middle, right verge):
--   row types: 0 top eave, 1 top slope (lit), 2 bottom slope with ridge cap,
--              3 bottom slope (shaded), 4 bottom eave, 5 ridge in the middle (odd heights)
-- The game rotates the finished roof when the ridge should run vertically.
local PITCHED = {
  {name="red",   ramp={"r","R","p"}, trim="x"},
  {name="slate", ramp={"k","d","m"}, trim="l"},
  {name="green", ramp={"g","G","h"}, trim="x"},
  {name="brown", ramp={"n","N","o"}, trim="T"},
  {name="teal",  ramp={"e","E","f"}, trim="x"},
  {name="barn",  ramp={"r","R","p"}, trim="x", ribs=true},
}
local pitched = sheet("pitched", 16, 16)

local function slope(mat, x, y, lit)
  local r = mat.ramp
  local base, line = lit and r[3] or r[2], lit and r[2] or r[1]
  if mat.ribs then return (x % 4 == 0) and line or base end
  if y % 4 == 3 then return line end
  if (x + (y // 4) * 4) % 8 == 0 then return line end
  return base
end

local function pitchedTile(mat, rowType, col)
  local im = img(16, 16)
  for y = 0, 15 do for x = 0, 15 do
    local c
    if rowType == 0 or rowType == 1 then c = slope(mat, x, y, true)
    elseif rowType == 5 then c = (y < 7) and slope(mat, x, y, true) or slope(mat, x, y, false)
    else c = slope(mat, x, y, false) end
    if rowType == 0 and y == 0 then c = mat.ramp[1] end
    if rowType == 0 and y == 1 then c = mat.trim end
    if rowType == 4 and y >= 14 then c = (y == 14) and "l" or "d" end
    if rowType == 2 and y <= 2 then c = (y == 0) and mat.ramp[3] or mat.ramp[1] end
    if rowType == 5 and (y == 7 or y == 8) then c = (y == 7) and mat.ramp[3] or mat.ramp[1] end
    if col == 0 and x <= 1 then c = (x == 0) and mat.ramp[1] or mat.trim end
    if col == 2 and x >= 14 then c = (x == 15) and mat.ramp[1] or mat.trim end
    px(im, x, y, c)
  end end
  return im
end

for _, mat in ipairs(PITCHED) do
  local frames = {}
  for rowType = 0, 5 do for col = 0, 2 do frames[#frames+1] = pitchedTile(mat, rowType, col) end end
  add(pitched, "pitched_" .. mat.name, frames)
end
save(pitched)


-- ================================================================== WALLS ==
-- 32x32 facade modules, one per floor. Frames per style:
--   0 window  1 twin windows  2 shopfront  3 plain
--   4 window lit  5 twin lit  6 shopfront lit  7 window lit (cool/TV)
-- "lit" frames hold only the emissive pixels; the game draws them over the
-- darkened facade at night.
local WALL_STYLES = {
  {name="teal",  base="E", light="f", dark="e", frame="F", sill="x", awn={"x","e"}},
  {name="rose",  base="R", light="p", dark="r", frame="c", sill="c", awn={"c","r"}},
  {name="cream", base="Y", light="c", dark="y", frame="x", sill="c", awn={"R","c"}},
  {name="plum",  base="U", light="P", dark="u", frame="k", sill="P", awn={"z","k"}, neon="z"},
  {name="brick", base="N", light="o", dark="n", frame="T", sill="T", awn={"G","T"}, brick=true},
  {name="mint",  base="h", light="H", dark="G", frame="x", sill="x", awn={"Y","G"}, neon="q"},
}

local walls = sheet("walls", 32, 32)

local function facade(st)
  local im = img(32, 32)
  for y = 0, 31 do for x = 0, 31 do
    local c = st.base
    if st.brick then
      local off = ((y // 4) % 2 == 0) and 0 or 4
      if y % 4 == 3 or (x + off) % 8 == 0 then c = st.dark end
    end
    if y <= 1 then c = st.light elseif y >= 30 then c = st.dark end
    px(im, x, y, c)
  end end
  return im
end

-- glass pane; lit = nil|"warm"|"cool". Mullions stay dark at night.
local function glass(im, x0, y0, w, h, lit, frame)
  local mx, my = x0 + w // 2, y0 + h // 3
  for y = y0, y0 + h - 1 do for x = x0, x0 + w - 1 do
    local mull = frame and (x == mx or y == my)
    local c
    if lit then
      if not mull then
        if lit == "warm" then
          c = (y - y0 < h * 0.45) and "j" or "Y"
          if x - x0 < 2 or x0 + w - 1 - x < 2 then c = "y" end -- curtains
        else
          c = (y - y0 < h * 0.5) and "V" or "q"
        end
      end
    else
      c = "B"
      local dd = (x - x0) - (y - y0)
      if dd >= 2 and dd <= 4 then c = "C" elseif dd == 5 then c = "v" end
      if y == y0 then c = "k" end
      if mull then c = frame end
    end
    if c then px(im, x, y, c) end
  end end
end

local function windowModule(st, lit)
  local im = lit and img(32, 32) or facade(st)
  if not lit then
    rect(im, 6, 4, 20, 1, st.light)
    rect(im, 6, 5, 20, 20, st.frame)
    rect(im, 5, 25, 22, 2, st.sill)
    rect(im, 5, 27, 22, 1, st.dark)
  end
  glass(im, 7, 6, 18, 18, lit, st.frame)
  return im
end

local function twinModule(st, lit)
  local im = lit and img(32, 32) or facade(st)
  for _, x0 in ipairs({3, 18}) do
    if not lit then
      rect(im, x0, 4, 11, 23, st.frame)
      rect(im, x0 - 1, 27, 13, 1, st.sill)
    end
    glass(im, x0 + 1, 5, 9, 21, lit, st.frame)
  end
  return im
end

local function shopModule(st, lit)
  local im = lit and img(32, 32) or facade(st)
  if not lit then
    for x = 0, 31 do
      local c = ((x // 4) % 2 == 0) and st.awn[1] or st.awn[2]
      for y = 2, 7 do px(im, x, y, c) end
      if x % 4 ~= 3 then px(im, x, 8, c) end
      px(im, x, 9, st.dark)
    end
    rect(im, 1, 11, 12, 19, st.frame); glass(im, 2, 12, 10, 17)
    rect(im, 19, 11, 12, 19, st.frame); glass(im, 20, 12, 10, 17)
    rect(im, 13, 11, 6, 21, "K"); rect(im, 14, 12, 4, 20, "k"); glass(im, 14, 13, 4, 7)
    px(im, 17, 22, "Y")
    rect(im, 0, 31, 32, 1, "d")
  else
    glass(im, 2, 12, 10, 17, "warm"); glass(im, 20, 12, 10, 17, "warm"); glass(im, 14, 13, 4, 7, "warm")
    if st.neon then rect(im, 2, 10, 28, 1, st.neon) end
  end
  return im
end

local function plainModule(st)
  local im = facade(st)
  local r = R()
  if r < 0.35 then -- drain pipe
    rect(im, 24, 0, 3, 32, "m"); rect(im, 26, 0, 1, 32, "d")
    for y = 3, 29, 9 do rect(im, 23, y, 5, 1, "d") end
  elseif r < 0.7 then -- wall AC unit
    rect(im, 8, 10, 16, 11, "K"); rect(im, 9, 11, 14, 9, "l"); rect(im, 9, 11, 14, 1, "x")
    for y = 13, 18, 2 do rect(im, 10, y, 12, 1, "m") end
    rect(im, 12, 21, 1, 6, "d")
  else -- vent grille
    rect(im, 10, 9, 12, 12, "K"); rect(im, 11, 10, 10, 10, "m")
    for y = 11, 19, 2 do rect(im, 11, y, 10, 1, "d") end
  end
  return im
end

for _, st in ipairs(WALL_STYLES) do
  add(walls, "wall_" .. st.name, {
    windowModule(st), twinModule(st), shopModule(st), plainModule(st),
    windowModule(st, "warm"), twinModule(st, "warm"), shopModule(st, "warm"), windowModule(st, "cool"),
  })
end
-- ------------------------------------------------ region facade kinds --
-- Same 8-frame contract as above (win, twin, ground, plain, lit win, lit twin,
-- lit ground, lit cool) so the game treats every style alike.

-- glass curtain wall (skyscrapers)
local function glassFrames(st)
  local function wall(variant, lit)
    local im = img(32, 32)
    for y = 0, 31 do for x = 0, 31 do
      local c
      local slab = y <= 2
      local mull = (variant == 1) and (x % 8 == 0) or (x % 16 == 0)
      if lit then
        if not slab and not mull and R() < 0.9 then c = (lit == "cool") and ((y < 16) and "V" or "q") or ((y < 16) and "j" or "Y") end
      else
        if slab then c = (y == 0) and st.light or st.dark
        elseif mull then c = st.frame
        else
          c = st.base
          local dd = (x % 16) - (y - 3)
          if dd >= 3 and dd <= 6 then c = st.light end
          if variant == 3 then c = st.dark end
        end
      end
      if c then px(im, x, y, c) end
    end end
    return im
  end
  local function lobby(lit)
    local im = lit and img(32, 32) or wall(0)
    if not lit then
      rect(im, 0, 26, 32, 6, "l"); rect(im, 9, 12, 14, 20, "K"); rect(im, 10, 13, 12, 19, "C")
      rect(im, 15, 13, 2, 19, "K"); rect(im, 6, 9, 20, 2, st.frame)
    else
      rect(im, 10, 13, 5, 19, "j"); rect(im, 17, 13, 5, 19, "j")
    end
    return im
  end
  return {wall(0), wall(1), lobby(), wall(3), wall(0, "warm"), wall(1, "warm"), lobby(true), wall(0, "cool")}
end

-- corrugated industrial shed: strip windows, roll-up doors
local function shedFrames(st)
  local function siding()
    local im = img(32, 32)
    for y = 0, 31 do for x = 0, 31 do
      local m = x % 4
      local c = (m == 0) and st.dark or ((m == 1) and st.light or st.base)
      if y <= 1 then c = st.light elseif y >= 30 then c = st.dark end
      px(im, x, y, c)
    end end
    return im
  end
  local function strip(lit)
    local im = lit and img(32, 32) or siding()
    if not lit then rect(im, 0, 5, 32, 7, "K") end
    for x = 0, 31 do for y = 6, 10 do
      if x % 8 ~= 0 then px(im, x, y, lit and ((y < 8) and "j" or "Y") or ((x % 8 == 3 and y < 9) and "C" or "B")) end
    end end
    return im
  end
  local function door(lit)
    local im = lit and img(32, 32) or siding()
    if not lit then
      rect(im, 2, 6, 28, 26, "K")
      for y = 7, 31 do rect(im, 3, y, 26, 1, (y % 3 == 0) and "d" or "m") end
      rect(im, 2, 4, 28, 2, "L"); for x = 2, 29, 4 do rect(im, x, 4, 2, 2, "K") end -- hazard lintel
    else
      rect(im, 3, 30, 26, 2, "j")
    end
    return im
  end
  local function vent()
    local im = siding()
    disc(im, 16, 14, 7, "K"); disc(im, 16, 14, 6, "d")
    for i = -5, 5 do px(im, 16 + i, 14, "m"); px(im, 16, 14 + i, "m") end
    return im
  end
  return {strip(), vent(), door(), siding(), strip(true), strip(true), door(true), strip(true)}
end

-- clapboard house: shuttered windows, front door with porch light
local function houseFrames(st)
  local function siding()
    local im = img(32, 32)
    for y = 0, 31 do for x = 0, 31 do
      local c = (y % 4 == 3) and st.dark or ((y % 4 == 0) and st.light or st.base)
      px(im, x, y, c)
    end end
    rect(im, 0, 30, 32, 2, "d")
    return im
  end
  local function win(lit, twin)
    local im = lit and img(32, 32) or siding()
    local xs = twin and {4, 19} or {10}
    local w = twin and 9 or 12
    for _, x0 in ipairs(xs) do
      if not lit then
        rect(im, x0 - 3, 7, 3, 15, st.shutter); rect(im, x0 + w, 7, 3, 15, st.shutter)
        rect(im, x0 - 1, 6, w + 2, 17, "x")
        rect(im, x0 - 2, 23, w + 4, 2, "x")
      end
      glass(im, x0, 7, w, 15, lit)
      if not lit then rect(im, x0, 13, w, 1, "x"); rect(im, x0 + w // 2, 7, 1, 15, "x") end
    end
    return im
  end
  local function door(lit)
    local im = lit and img(32, 32) or siding()
    if not lit then
      rect(im, 6, 4, 20, 3, st.shutter); rect(im, 5, 7, 22, 1, "K")                 -- porch roof
      rect(im, 11, 10, 10, 20, "x"); rect(im, 12, 11, 8, 19, st.door or "N")
      rect(im, 13, 13, 6, 6, st.shutter); px(im, 18, 21, "Y")
      rect(im, 8, 30, 16, 2, "l")                                                    -- step
      rect(im, 24, 11, 2, 3, "K"); px(im, 24, 12, "Y")
    else
      rect(im, 22, 9, 6, 6, "j"); rect(im, 13, 13, 6, 6, "Y")
    end
    return im
  end
  return {win(), win(nil, true), door(), siding(), win("warm"), win("warm", true), door(true), win("cool")}
end

-- red barn boards, loft door, big X-braced doors
local function barnFrames(st)
  local function boards()
    local im = img(32, 32)
    for y = 0, 31 do for x = 0, 31 do px(im, x, y, (x % 4 == 0) and st.dark or st.base) end end
    rect(im, 0, 0, 32, 2, "x")
    return im
  end
  local function xdoor(x0, y0, w, h)
    return function(im)
      rect(im, x0, y0, w, h, "x"); rect(im, x0 + 2, y0 + 2, w - 4, h - 4, st.dark)
      for i = 0, w - 5 do
        local yy = y0 + 2 + math.floor(i * (h - 5) / (w - 5))
        px(im, x0 + 2 + i, yy, "x"); px(im, x0 + w - 3 - i, yy, "x")
      end
    end
  end
  local function loft(lit)
    local im = lit and img(32, 32) or boards()
    if not lit then xdoor(9, 6, 14, 14)(im) else rect(im, 11, 8, 10, 10, "Y") end
    return im
  end
  local function big(lit)
    local im = lit and img(32, 32) or boards()
    if not lit then xdoor(2, 4, 28, 28)(im) else rect(im, 4, 30, 24, 2, "j") end
    return im
  end
  return {loft(), boards(), big(), boards(), loft(true), loft(true), big(true), loft(true)}
end

-- open parking deck: concrete slabs, dark openings with parked cars
local function deckFrames(st)
  local function level(car, lit)
    local im = img(32, 32)
    if not lit then
      rect(im, 0, 0, 32, 32, "k")
      rect(im, 0, 0, 32, 6, "l"); rect(im, 0, 5, 32, 1, "m"); rect(im, 0, 0, 32, 1, "x")
      rect(im, 0, 6, 3, 26, "m")
      if car then rect(im, 7, 20, 20, 8, car); rect(im, 9, 17, 14, 4, car); rect(im, 10, 18, 12, 2, "B"); rect(im, 8, 28, 4, 2, "K"); rect(im, 22, 28, 4, 2, "K") end
    else
      rect(im, 4, 6, 26, 1, "j")
    end
    return im
  end
  local function entry(lit)
    local im = lit and img(32, 32) or level()
    if not lit then
      rect(im, 3, 16, 29, 2, "z"); for x = 3, 31, 6 do rect(im, x, 16, 3, 2, "x") end
      rect(im, 3, 14, 2, 18, "L")
    else rect(im, 3, 10, 29, 1, "j") end
    return im
  end
  local plain = img(32, 32); rect(plain, 0, 0, 32, 32, "l"); rect(plain, 0, 0, 32, 1, "x"); rect(plain, 0, 31, 32, 1, "m")
  return {level("R"), level("C"), entry(), plain, level(nil, true), level(nil, true), entry(true), level(nil, true)}
end

local KIND_FRAMES = { glass = glassFrames, shed = shedFrames, house = houseFrames, barn = barnFrames, deck = deckFrames }
local REGION_WALLS = {
  {name="glass",   kind="glass", base="B", light="C", dark="k", frame="l"},
  {name="glassg",  kind="glass", base="e", light="f", dark="K", frame="F"},
  {name="shed",    kind="shed",  base="l", light="x", dark="m"},
  {name="shedr",   kind="shed",  base="N", light="o", dark="n"},
  {name="store_a", base="p", light="c", dark="R", frame="x", sill="x", awn={"q","x"}, neon="q"},
  {name="store_b", base="Y", light="c", dark="y", frame="U", sill="c", awn={"U","c"}, neon="z"},
  {name="store_c", base="F", light="x", dark="f", frame="x", sill="x", awn={"R","x"}, neon="z"},
  {name="mall",    base="T", light="x", dark="S", frame="l", sill="x", awn={"E","x"}, neon="q"},
  {name="deck",    kind="deck"},
  {name="house_white",  kind="house", base="x", light="x", dark="l", shutter="B", door="R"},
  {name="house_pink",   kind="house", base="p", light="c", dark="R", shutter="x", door="e"},
  {name="house_mint",   kind="house", base="F", light="x", dark="f", shutter="e", door="Y"},
  {name="house_yellow", kind="house", base="Y", light="c", dark="y", shutter="G", door="R"},
  {name="house_blue",   kind="house", base="C", light="V", dark="B", shutter="x", door="Y"},
  {name="barn",    kind="barn", base="R", dark="r"},
}
for _, st in ipairs(REGION_WALLS) do
  local frames
  if st.kind then frames = KIND_FRAMES[st.kind](st)
  else
    frames = {windowModule(st), twinModule(st), shopModule(st), plainModule(st),
              windowModule(st, "warm"), twinModule(st, "warm"), shopModule(st, "warm"), windowModule(st, "cool")}
  end
  add(walls, "wall_" .. st.name, frames)
end
save(walls)


-- =================================================================== CARS ==
-- Procedural top-down vehicles, facing up, lit from the top-left.
-- Every model tag has 3 frames: normal, braking, wreck.
--   cars  (32x64):  hatch sedan sport muscle suv taxi police police_suv pickup van
--   heavy (36x168): bus truck semi
--   tank  (48x72):  hull (normal, treads moved, wreck), turret (normal, wreck)

-- inside a w x h rounded rect whose front (top) corners have radius rf, back rb
local function roundIn(x, y, w, h, rf, rb)
  local r = (y < h / 2) and rf or rb
  if r <= 0 then return true end
  local cx = math.max(r - 0.5, math.min(w - r - 0.5, x))
  local cy = math.max(r - 0.5, math.min(h - r - 0.5, y))
  local dx, dy = x - cx, y - cy
  return dx * dx + dy * dy <= r * r
end

-- drawing context with a local origin
local function V(im, ox, oy)
  local v = {im = im, ox = ox, oy = oy}
  function v.p(x, y, c) px(im, ox + x, oy + y, c) end
  function v.r(x, y, w, h, c) rect(im, ox + x, oy + y, w, h, c) end
  function v.get(x, y) return get(im, ox + x, oy + y) end
  return v
end

-- body panel with bevel shading; ramp = {dark, mid, light}
local function shell(v, x0, y0, w, h, rf, rb, ramp)
  for y = 0, h - 1 do for x = 0, w - 1 do
    if roundIn(x, y, w, h, rf, rb) then
      local c = ramp[2]
      if x <= 1 or y <= 1 then c = ramp[3] end
      if x >= w - 2 or y >= h - 2 then c = ramp[1] end
      v.p(x0 + x, y0 + y, c)
    end
  end end
end

-- glass band; inset(j) narrows row j from both sides
local function glassBand(v, x0, y0, w, h, inset)
  for j = 0, h - 1 do
    local ins = inset and inset(j) or 0
    for x = x0 + ins, x0 + w - 1 - ins do
      local dd = (x - x0) - j * 2
      local c = "k"
      if dd >= 4 and dd <= 6 then c = "C" elseif dd == 7 then c = "B" end
      v.p(x, y0 + j, c)
    end
  end
end

local function tyres(v, w, ys, len)
  for _, ay in ipairs(ys) do
    v.r(-1, ay - len // 2, 2, len, "K"); v.r(w - 1, ay - len // 2, 2, len, "K")
    for k = 0, len - 1, 3 do v.p(-1, ay - len // 2 + k, "d"); v.p(w, ay - len // 2 + k, "d") end
  end
end

local function headlights(v, w, x0)
  x0 = x0 or 2
  v.r(x0, 1, 4, 2, "c"); v.r(w - x0 - 4, 1, 4, 2, "c")
  v.p(x0 + 1, 1, "j"); v.p(w - x0 - 2, 1, "j")
end
local function taillights(v, w, l, mode, x0)
  x0 = x0 or 2
  local a, b = "r", "R"
  if mode == "brake" then a, b = "z", "p" end
  v.r(x0, l - 3, 4, 2, a); v.r(w - x0 - 4, l - 3, 4, 2, a)
  v.p(x0 + 1, l - 3, b); v.p(w - x0 - 2, l - 3, b)
end

-- recolour a finished vehicle as a burnt wreck, keeping its shape and shading
local function wreckify(im)
  local out = copy(im)
  local list = {"K", "k", "d", "m"}
  for y = 0, im.height - 1 do for x = 0, im.width - 1 do
    local c = im:getPixel(x, y)
    if pc.rgbaA(c) > 0 then
      local lum = (pc.rgbaR(c) * 0.3 + pc.rgbaG(c) * 0.55 + pc.rgbaB(c) * 0.15) / 255
      local n = ramp(list, lum * 0.9, x, y)
      local r = R()
      if lum > 0.25 and r < 0.1 then n = C.n elseif lum > 0.25 and r < 0.15 then n = C.N end
      out:drawPixel(x, y, n)
    end
  end end
  -- scorch blotches
  for _ = 1, math.max(3, (im.width * im.height) // 400) do
    local cx, cy = R(4, im.width - 5), R(4, im.height - 5)
    for dy = -2, 2 do for dx = -2, 2 do
      if dx * dx + dy * dy <= 5 and pc.rgbaA(get(out, cx + dx, cy + dy)) > 0 then px(out, cx + dx, cy + dy, "K") end
    end end
  end
  return out
end

local CAR_SPECS = {
  hatch  = {w=24, l=44, hood=12, ws=6, roofEnd=34, rw=5, ax={9, 34}, body={"G","h","H"}},
  sedan  = {w=26, l=52, hood=15, ws=7, roofEnd=36, rw=5, ax={11, 40}, body={"e","E","f"}},
  sport  = {w=26, l=50, hood=19, ws=6, roofEnd=32, rw=5, ax={11, 39}, rf=6, body={"r","R","p"}, kind="sport"},
  muscle = {w=26, l=54, hood=19, ws=7, roofEnd=38, rw=5, ax={12, 42}, body={"k","B","C"}, kind="muscle"},
  suv    = {w=28, l=56, hood=13, ws=7, roofEnd=49, rw=4, ax={11, 44}, rf=3, rb=2, body={"d","m","l"}, kind="suv"},
  taxi   = {w=26, l=52, hood=15, ws=7, roofEnd=36, rw=5, ax={11, 40}, body={"y","L","Y"}, kind="taxi"},
  police = {w=26, l=52, hood=15, ws=7, roofEnd=36, rw=5, ax={11, 40}, body={"d","l","x"}, kind="police"},
  police_suv = {w=28, l=56, hood=13, ws=7, roofEnd=49, rw=4, ax={11, 44}, rf=3, rb=2, body={"k","B","C"}, kind="police_suv"},
  pickup = {w=28, l=58, hood=14, ws=7, roofEnd=30, rw=3, ax={11, 46}, rf=3, rb=2, body={"n","N","o"}, kind="pickup"},
  van    = {w=28, l=58, hood=7,  ws=6, roofEnd=55, rw=0, ax={9, 46}, rf=4, rb=1, body={"u","U","P"}, kind="van"},
}
local CAR_ORDER = {"hatch", "sedan", "sport", "muscle", "suv", "taxi", "police", "police_suv", "pickup", "van"}

local function lightbar(v, x0, x1, y)
  v.r(x0, y, x1 - x0, 4, "K")
  local mid = (x0 + x1) // 2
  v.r(x0 + 1, y + 1, mid - x0 - 1, 2, "z"); v.r(mid, y + 1, x1 - mid - 1, 2, "B")
  v.p(x0 + 2, y + 1, "p"); v.p(mid + 1, y + 1, "C")
end

local function carImage(name, mode)
  local s = CAR_SPECS[name]
  local im = img(32, 64)
  local w, l = s.w, s.l
  local v = V(im, (32 - w) // 2, (64 - l) // 2)
  local B = s.body
  tyres(v, w, s.ax, 8)
  shell(v, 0, 0, w, l, s.rf or 4, s.rb or 3, B)
  local H, WS, RE, RW = s.hood, s.ws, s.roofEnd, s.rw
  local isBody = function(x, y)
    local c = v.get(x, y)
    return c == C[B[1]] or c == C[B[2]] or c == C[B[3]]
  end
  -- hood creases
  for y = 3, H - 3 do v.p(w // 2 - 4, y, B[3]); v.p(w // 2 + 3, y, B[1]) end
  -- windshield narrows toward the roof
  glassBand(v, 0, H, w, WS, function(j) return 2 + j // 2 end)
  local rx0 = 2 + WS // 2
  local roofTop = H + WS
  v.r(rx0, roofTop, w - 2 * rx0, RE - roofTop, B[3])
  v.r(rx0 + 1, roofTop + 1, w - 2 * rx0 - 2, RE - roofTop - 2, B[2])
  v.r(rx0 + 1, roofTop + 1, w - 2 * rx0 - 2, 1, B[3])
  for y = roofTop, RE - 1 do v.p(rx0 - 1, y, "k"); v.p(w - rx0, y, "k") end -- side glass
  if RW > 0 then glassBand(v, 0, RE, w, RW, function(j) return math.max(2, rx0 - 1 - j // 2) end) end
  v.r(3, H - 1, w - 6, 1, B[1]) -- cowl seam
  local trunkY = RE + RW
  if trunkY < l - 5 then v.r(4, trunkY + 1, w - 8, 1, B[1]) end
  -- side mirrors
  v.r(-2, H + 1, 2, 2, B[1]); v.r(w, H + 1, 2, 2, B[1])

  local k = s.kind
  if k == "sport" then
    v.r(w // 2 - 5, 6, 3, 6, "k"); v.r(w // 2 + 2, 6, 3, 6, "k")        -- hood vents
    v.r(-1, l - 8, w + 2, 3, B[1]); v.r(0, l - 7, w, 1, "K")            -- spoiler
  elseif k == "muscle" then
    for y = 0, l - 1 do for _, x in ipairs({w // 2 - 3, w // 2 - 2, w // 2 + 1, w // 2 + 2}) do
      if isBody(x, y) then v.p(x, y, "x") end
    end end
    v.r(w // 2 - 3, 7, 6, 6, "K"); v.r(w // 2 - 2, 8, 4, 4, "k")         -- hood scoop
  elseif k == "suv" or k == "police_suv" then
    for y = roofTop + 1, RE - 2 do v.p(rx0 + 1, y, "K"); v.p(w - rx0 - 2, y, "K") end -- roof rails
    for _, y in ipairs({roofTop + 8, RE - 9}) do v.r(rx0 + 1, y, w - 2 * rx0 - 2, 1, "d") end
    if k == "police_suv" then
      v.r(rx0 + 2, roofTop + 2, w - 2 * rx0 - 4, RE - roofTop - 4, "x")
      lightbar(v, rx0 + 1, w - rx0 - 1, roofTop + 13)
      v.r(3, -2, w - 6, 2, "K"); for x = 4, w - 5, 3 do v.p(x, -2, "d") end -- push bar
    end
  elseif k == "taxi" then
    v.r(w // 2 - 5, roofTop + 4, 10, 5, "K"); v.r(w // 2 - 4, roofTop + 5, 8, 3, "c")
    v.r(w // 2 - 2, roofTop + 6, 4, 1, "O")
    for y = trunkY + 3, l - 4, 2 do v.p(3 + (y % 4), y, "K"); v.p(w - 4 - (y % 4), y, "K") end -- checker hint
  elseif k == "police" then
    for y = 0, l - 1 do for x = 0, w - 1 do
      if (y < H or y > trunkY) and isBody(x, y) then
        local c = v.get(x, y)
        v.p(x, y, (c == C[B[3]]) and "d" or "k")
      end
    end end
    lightbar(v, rx0, w - rx0, roofTop + 4)
  elseif k == "pickup" then
    local by = RE + RW + 1
    v.r(0, by, 2, l - by - 3, B[2]); v.r(w - 2, by, 2, l - by - 3, B[1])
    v.r(2, by, w - 4, l - by - 3, "k")
    for y = by + 2, l - 5, 4 do v.r(2, y, w - 4, 1, "d") end
    v.r(0, by, w, 1, B[3])
  elseif k == "van" then
    for y = roofTop + 4, RE - 2, 6 do v.r(rx0, y, w - 2 * rx0, 1, B[1]) end
    v.r(w // 2, l - 5, 1, 4, "K")
  end
  headlights(v, w); v.r(7, 1, w - 14, 1, "d")
  taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

local cars = sheet("cars", 32, 64)
for _, name in ipairs(CAR_ORDER) do
  local a, b = carImage(name, "normal"), carImage(name, "brake")
  add(cars, name, {a, b, wreckify(a)})
end
-- tractor: narrow hood, cab at the back, huge rear wheels
local function tractorImage(mode)
  local im = img(32, 64)
  local w, l = 26, 40
  local v = V(im, 3, 12)
  local B = {"g", "G", "h"}
  for _, x0 in ipairs({-1, w - 6}) do                     -- rear wheels
    v.r(x0, l - 19, 7, 16, "K")
    for y = l - 18, l - 5, 3 do v.r(x0 + 1, y, 5, 1, "d") end
    v.r(x0 + 2, l - 13, 3, 4, "L")
  end
  for _, x0 in ipairs({3, w - 7}) do v.r(x0, 3, 4, 9, "K"); v.r(x0 + 1, 6, 2, 3, "L") end -- front wheels
  shell(v, w // 2 - 6, 0, 12, 24, 3, 1, B)                 -- hood
  for y = 4, 20, 3 do v.r(w // 2 - 4, y, 8, 1, B[1]) end   -- grille slats
  v.r(w // 2 - 7, l - 22, 14, 3, "K")
  shell(v, 5, 18, w - 10, 20, 2, 2, B)                     -- cab
  v.r(6, 19, w - 12, 18, "k"); v.r(7, 20, w - 14, 16, "H"); v.r(8, 21, w - 16, 14, "h") -- glass + roof
  v.r(-1, l - 21, 7, 3, B[2]); v.r(w - 6, l - 21, 7, 3, B[2]) -- fenders
  v.p(w // 2 - 4, 2, "K"); v.p(w // 2 - 4, 3, "d")        -- exhaust
  v.r(w // 2 - 5, 0, 3, 2, "c"); v.r(w // 2 + 2, 0, 3, 2, "c")
  v.r(7, l - 2, 3, 2, mode == "brake" and "z" or "r"); v.r(w - 10, l - 2, 3, 2, mode == "brake" and "z" or "r")
  outline(im, "K")
  return im
end

-- forklift: counterweight, overhead guard, forks up front
local function forkliftImage(mode)
  local im = img(32, 64)
  local w, l = 20, 34
  local v = V(im, 6, 18)
  v.r(4, -12, 3, 14, "d"); v.r(w - 7, -12, 3, 14, "d")    -- forks
  v.r(2, 0, w - 4, 3, "K")                                  -- mast
  tyres(v, w, {6, l - 8}, 7)
  shell(v, 0, 2, w, l - 2, 2, 5, {"y", "L", "Y"})
  v.r(3, 6, w - 6, 14, "K")                                 -- guard cage
  for x = 4, w - 5, 3 do v.r(x, 7, 1, 12, "d") end
  v.r(4, 11, w - 8, 5, "k")                                 -- seat
  shell(v, 1, l - 12, w - 2, 12, 2, 5, {"k", "d", "m"})     -- counterweight
  v.r(4, l - 2, 3, 1, mode == "brake" and "z" or "r"); v.r(w - 7, l - 2, 3, 1, mode == "brake" and "z" or "r")
  outline(im, "K")
  return im
end

for _, e in ipairs({{"tractor", tractorImage}, {"forklift", forkliftImage}}) do
  local a, b = e[2]("normal"), e[2]("brake")
  add(cars, e[1], {a, b, wreckify(a)})
end
save(cars)

-- ------------------------------------------------------------ heavy --
local function busImage(mode)
  local im = img(36, 168)
  local w, l = 34, 120
  local v = V(im, 1, (168 - l) // 2)
  local B = {"e", "E", "f"}
  tyres(v, w, {18, l - 34, l - 22}, 10)
  shell(v, 0, 0, w, l, 5, 3, B)
  glassBand(v, 0, 3, w, 6, function(j) return 2 end)
  v.r(8, 1, w - 16, 2, "K"); for x = 10, w - 11, 3 do v.p(x, 1, "L") end -- destination sign
  for y = 11, l - 10 do                                                 -- side windows
    local pillar = (y - 11) % 12 >= 10
    local c = pillar and B[2] or "k"
    v.p(1, y, c); v.p(2, y, c); v.p(w - 3, y, c); v.p(w - 2, y, c)
  end
  v.r(4, 11, w - 8, l - 19, "Y"); v.r(5, 12, w - 10, l - 21, "c")      -- roof
  for _, y in ipairs({26, 74}) do                                       -- AC units
    v.r(w // 2 - 7, y, 14, 16, "K"); v.r(w // 2 - 6, y + 1, 12, 14, "l")
    for yy = y + 3, y + 13, 2 do v.r(w // 2 - 5, yy, 10, 1, "m") end
  end
  for _, y in ipairs({52, 98}) do v.r(w // 2 - 4, y, 8, 8, "m"); v.r(w // 2 - 3, y + 1, 6, 6, "l") end
  for y = l - 7, l - 4 do v.r(8, y, w - 16, 1, (y % 2 == 0) and "K" or "d") end -- engine grille
  headlights(v, w); taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

local function truckImage(mode)
  local im = img(36, 168)
  local w, l = 32, 84
  local v = V(im, 2, (168 - l) // 2)
  local cab = {"r", "R", "p"}
  tyres(v, w, {10, l - 24, l - 12}, 10)
  shell(v, 1, 0, w - 2, 27, 4, 2, cab)
  glassBand(v, 1, 7, w - 2, 5, function(j) return 3 + j // 2 end)
  v.r(6, 13, w - 12, 11, cab[3]); v.r(7, 14, w - 14, 9, cab[2])
  for x = 8, w - 9, 4 do v.p(x, 13, "y") end                          -- marker lights
  v.r(-2, 8, 2, 3, cab[1]); v.r(w, 8, 2, 3, cab[1])                    -- mirrors
  v.r(3, 27, w - 6, 3, "K"); v.r(w // 2 - 1, 27, 2, 3, "d")
  shell(v, 0, 30, w, l - 30, 1, 1, {"S", "T", "x"})
  for y = 36, l - 4, 6 do v.r(2, y, w - 4, 1, "S") end
  v.r(3, 30, 2, l - 32, "E"); v.r(w - 5, 30, 2, l - 32, "E")          -- company stripe
  v.r(w // 2 - 6, 50, 12, 10, "E"); v.r(w // 2 - 4, 52, 8, 6, "c")    -- roof logo
  headlights(v, w, 3); taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

local function semiImage(mode)
  local im = img(36, 168)
  local w, l = 32, 164
  local v = V(im, 2, (168 - l) // 2)
  local cab = {"w", "W", "v"}
  tyres(v, w, {10, 32, 37, l - 24, l - 12}, 8)
  shell(v, 1, 0, w - 2, 40, 5, 2, cab)
  for y = 3, 13 do v.p(w // 2 - 5, y, cab[3]); v.p(w // 2 + 4, y, cab[1]) end -- long nose
  v.r(w // 2 - 4, 1, 8, 2, "l")                                        -- chrome grille
  glassBand(v, 1, 15, w - 2, 5, function(j) return 3 + j // 2 end)
  v.r(6, 21, w - 12, 10, cab[3]); v.r(7, 22, w - 14, 8, cab[2])
  shell(v, 4, 30, w - 8, 9, 4, 1, {"W", "v", "V"})                    -- air deflector
  v.r(-2, 16, 2, 3, cab[1]); v.r(w, 16, 2, 3, cab[1])
  for _, x in ipairs({2, w - 4}) do v.r(x, 22, 2, 12, "l") end         -- exhaust stacks
  v.r(4, 40, w - 8, 4, "K"); v.r(w // 2 - 3, 40, 6, 4, "d")           -- fifth wheel
  shell(v, 0, 44, w, l - 44, 1, 1, {"m", "l", "x"})
  for y = 50, l - 4, 10 do v.r(2, y, w - 4, 1, "l") end
  v.r(2, 44, 2, l - 46, "R"); v.r(w - 4, 44, 2, l - 46, "R")
  v.r(6, 90, w - 12, 20, "R"); v.r(8, 92, w - 16, 16, "p")            -- roof graphic
  headlights(v, w, 3); taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

local heavy = sheet("heavy", 36, 168)
for _, e in ipairs({{"bus", busImage}, {"truck", truckImage}, {"semi", semiImage}}) do
  local a, b = e[2]("normal"), e[2]("brake")
  add(heavy, e[1], {a, b, wreckify(a)})
end
-- shared truck cab (0..26 px) with windshield, roof, mirrors
local function truckCab(v, w, cab)
  shell(v, 1, 0, w - 2, 27, 4, 2, cab)
  glassBand(v, 1, 7, w - 2, 5, function(j) return 3 + j // 2 end)
  v.r(6, 13, w - 12, 11, cab[3]); v.r(7, 14, w - 14, 9, cab[2])
  v.r(-2, 8, 2, 3, cab[1]); v.r(w, 8, 2, 3, cab[1])
  v.r(3, 27, w - 6, 3, "K"); v.r(w // 2 - 1, 27, 2, 3, "d")
end

-- cylinder seen from above: bright along the middle, dark at the sides
local function cylinder(v, x0, y0, w, h, list)
  for y = y0, y0 + h - 1 do for x = x0, x0 + w - 1 do
    local t = math.abs((x - x0 + 0.5) / w - 0.5) * 2
    local edge = (y - y0 < 3 or y0 + h - 1 - y < 3) and 0.25 or 0
    v.p(x, y, ramp(list, 1 - t * t - edge, x, y))
  end end
end

local function tankerImage(mode)
  local im = img(36, 168)
  local w, l = 32, 164
  local v = V(im, 2, 2)
  tyres(v, w, {10, 32, 37, l - 24, l - 12}, 8)
  truckCab(v, w, {"r", "R", "p"})
  v.r(4, 30, w - 8, 12, "K"); v.r(w // 2 - 3, 32, 6, 6, "d")
  cylinder(v, 1, 44, w - 2, l - 46, {"m", "l", "x", "x"})
  for y = 60, l - 12, 24 do v.r(2, y, w - 4, 1, "m") end
  v.r(w // 2 - 1, 46, 2, l - 50, "d")                       -- catwalk
  for y = 70, l - 20, 40 do disc(im, 2 + w // 2, 2 + y, 3, "d"); disc(im, 2 + w // 2, 2 + y, 2, "l") end
  v.r(w // 2 - 5, 100, 10, 10, "O"); v.r(w // 2 - 3, 102, 6, 6, "L") -- hazard diamond (flat)
  headlights(v, w, 3); taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

local function flatbedImage(mode)
  local im = img(36, 168)
  local w, l = 32, 96
  local v = V(im, 2, (168 - l) // 2)
  tyres(v, w, {10, l - 26, l - 14}, 10)
  truckCab(v, w, {"B", "C", "V"})
  shell(v, 0, 30, w, l - 30, 1, 1, {"n", "N", "o"})
  for y = 32, l - 3, 4 do v.r(1, y, w - 2, 1, "n") end
  for i = 0, 3 do                                           -- log load
    local x0 = 3 + i * 7
    cylinder(v, x0, 34, 6, l - 40, {"n", "N", "o"})
    v.r(x0 + 1, 34, 4, 2, "Y"); v.r(x0 + 1, l - 8, 4, 2, "Y")
  end
  for _, y in ipairs({44, 64, 84}) do v.r(0, y, w, 1, "d") end -- straps
  headlights(v, w, 3); taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

local function mixerImage(mode)
  local im = img(36, 168)
  local w, l = 32, 84
  local v = V(im, 2, (168 - l) // 2)
  tyres(v, w, {10, l - 26, l - 14}, 10)
  truckCab(v, w, {"y", "L", "Y"})
  shell(v, 2, 30, w - 4, l - 30, 1, 1, {"d", "m", "l"})
  for y = 34, l - 8 do                                      -- drum with spiral stripes
    local half = math.floor((w - 8) / 2 * math.sin(math.pi * (y - 30) / (l - 34)))
    for x = w // 2 - half, w // 2 + half do
      local t = math.abs(x - w / 2) / math.max(1, half)
      local c = ramp({"m", "l", "x"}, 1 - t, x, y)
      if (x + y) % 10 < 3 then c = "O" end
      v.p(x, y, c)
    end
  end
  v.r(w // 2 - 2, l - 8, 4, 8, "d")                          -- chute
  headlights(v, w, 3); taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

local function garbageImage(mode)
  local im = img(36, 168)
  local w, l = 32, 80
  local v = V(im, 2, (168 - l) // 2)
  tyres(v, w, {10, l - 24, l - 12}, 10)
  truckCab(v, w, {"x", "l", "x"})
  shell(v, 0, 30, w, l - 30, 2, 3, {"g", "G", "h"})
  for y = 34, l - 16, 5 do v.r(2, y, w - 4, 1, "g") end
  v.r(2, l - 14, w - 4, 12, "d"); v.r(4, l - 12, w - 8, 8, "k") -- hopper
  v.r(3, 30, 3, l - 32, "L")                                 -- stripe
  headlights(v, w, 3); taillights(v, w, l, mode)
  outline(im, "K")
  return im
end

for _, e in ipairs({{"tanker", tankerImage}, {"flatbed", flatbedImage}, {"mixer", mixerImage}, {"garbage", garbageImage}}) do
  local a, b = e[2]("normal"), e[2]("brake")
  add(heavy, e[1], {a, b, wreckify(a)})
end
save(heavy)

-- ------------------------------------------------------------- wide --
-- 48x96 cells: combine harvester and 20ft shipping containers (top view).
local wide = sheet("wide", 48, 96)

local function harvesterImage(mode)
  local im = img(48, 96)
  local w, l = 44, 72
  local v = V(im, 2, 12)
  local B = {"r", "R", "p"}
  v.r(0, 0, w, 12, "K"); v.r(1, 1, w - 2, 10, "y")          -- header
  for x = 2, w - 3, 3 do v.r(x, 2, 1, 8, "L") end           -- reel bats
  v.r(1, 10, w - 2, 1, "O")
  v.r(w // 2 - 4, 11, 8, 6, "d")                             -- feeder
  tyres(v, w - 8, {26, l - 12}, 12)
  shell(v, 6, 14, w - 12, l - 14, 3, 4, B)
  v.r(12, 16, w - 24, 12, "k"); v.r(13, 17, w - 26, 10, "C"); v.r(14, 18, w - 28, 8, "B") -- cab glass
  v.r(10, 32, w - 20, 22, "K"); v.r(11, 33, w - 22, 20, "Y")                               -- grain tank
  for y = 34, 52, 3 do for x = 12, w - 13, 4 do v.p(x + (y % 2), y, "y") end end
  v.r(w - 9, 30, 4, 34, "d"); v.r(w - 8, 31, 2, 32, "m")    -- folded unloading auger
  for y = l - 12, l - 4, 2 do v.r(12, y, w - 24, 1, B[1]) end
  v.r(8, l - 2, 3, 2, mode == "brake" and "z" or "r"); v.r(w - 11, l - 2, 3, 2, mode == "brake" and "z" or "r")
  outline(im, "K")
  return im
end
do
  local a, b = harvesterImage("normal"), harvesterImage("brake")
  add(wide, "harvester", {a, b, wreckify(a)})
end

local function container(ramp3, stripe)
  local im = img(48, 96)
  local v = V(im, 8, 8)
  local w, l = 32, 80
  v.r(0, 0, w, l, ramp3[2])
  for y = 2, l - 3, 3 do v.r(1, y, w - 2, 1, ramp3[1]) end
  v.r(0, 0, w, 2, ramp3[3]); v.r(0, 0, 2, l, ramp3[3]); v.r(w - 2, 0, 2, l, ramp3[1]); v.r(0, l - 2, w, 2, ramp3[1])
  for _, p in ipairs({{0, 0}, {w - 4, 0}, {0, l - 4}, {w - 4, l - 4}}) do v.r(p[1], p[2], 4, 4, "K"); v.r(p[1] + 1, p[2] + 1, 2, 2, "d") end
  if stripe then v.r(w // 2 - 3, 12, 6, l - 24, stripe) end
  outline(im, "K")
  return im
end
add(wide, "container_red", {container({"r", "R", "p"}, "x")})
add(wide, "container_blue", {container({"w", "B", "C"})})
add(wide, "container_teal", {container({"e", "E", "f"}, "c")})
add(wide, "container_yellow", {container({"y", "L", "Y"})})
save(wide)

-- ------------------------------------------------------------- rail --
-- 40x128 cells, facing up: locomotive, boxcar, tank car, container flat.
local railsheet = sheet("rail", 40, 128)
local function railcar(kind)
  local im = img(40, 128)
  local w, l = 34, kind == "loco" and 112 or 104
  local v = V(im, 3, (128 - l) // 2)
  for _, y in ipairs({14, 22, l - 22, l - 14}) do v.r(1, y - 3, 3, 6, "K"); v.r(w - 4, y - 3, 3, 6, "K") end -- bogies
  v.r(w // 2 - 2, -2, 4, 3, "d"); v.r(w // 2 - 2, l - 1, 4, 3, "d")                                         -- couplers
  if kind == "loco" then
    shell(v, 1, 0, w - 2, l, 5, 3, {"w", "B", "C"})
    v.r(3, 4, w - 6, 20, "L"); v.r(3, 4, w - 6, 2, "Y")                                       -- nose
    glassBand(v, 3, 24, w - 6, 8, function(j) return 1 end)                                    -- cab glass
    v.r(5, 34, w - 10, 16, "C")                                                                 -- cab roof
    for i = 0, 2 do                                                                             -- radiator fans
      local cy = 64 + i * 16
      disc(im, 3 + w // 2, (128 - l) // 2 + cy, 6, "K"); disc(im, 3 + w // 2, (128 - l) // 2 + cy, 5, "d")
      for k = -4, 4 do v.p(w // 2 + k, cy, "m"); v.p(w // 2, cy + k, "m") end
    end
    for y = 2, l - 3, 2 do v.p(0, y, "x"); v.p(w - 1, y, "x") end                              -- handrails
    v.r(4, l - 6, w - 8, 3, "L")
    headlights(v, w, 4)
  elseif kind == "box" then
    shell(v, 1, 0, w - 2, l, 1, 1, {"n", "N", "o"})
    for y = 4, l - 4, 6 do v.r(2, y, w - 4, 1, "n") end
    v.r(w // 2 - 1, 2, 2, l - 4, "k")                                                           -- roof walk
  elseif kind == "tank" then
    shell(v, 1, 0, w - 2, l, 1, 1, {"K", "k", "d"})
    cylinder(v, 2, 6, w - 4, l - 12, {"K", "k", "d", "m"})
    disc(im, 3 + w // 2, (128 - l) // 2 + l // 2, 5, "d"); disc(im, 3 + w // 2, (128 - l) // 2 + l // 2, 3, "m")
    v.r(4, l // 2 + 10, w - 8, 3, "R")
  else -- container flat
    shell(v, 1, 0, w - 2, l, 1, 1, {"n", "N", "o"})
    local c = container({"e", "E", "f"}, "c")
    im:drawImage(c, Point(-5, 12))
  end
  outline(im, "K")
  return im
end
add(railsheet, "loco", {railcar("loco")})
add(railsheet, "boxcar", {railcar("box")})
add(railsheet, "tankcar", {railcar("tank")})
add(railsheet, "flatcar", {railcar("flat")})
save(railsheet)

-- ------------------------------------------------------------- tank --
local ARMY = {"g", "G", "h"}
local function hullImage(phase)
  local im = img(48, 72)
  local w, l = 36, 60
  local v = V(im, 6, 6)
  -- tracks
  for _, x0 in ipairs({0, w - 8}) do
    v.r(x0, 0, 8, l, "K")
    for y = 1, l - 2 do
      local link = (y + phase) % 4
      v.r(x0 + 1, y, 6, 1, link == 0 and "k" or (link == 1 and "m" or "d"))
    end
    v.r(x0 + 1, 2, 6, 3, "d"); v.r(x0 + 1, l - 5, 6, 3, "d") -- sprockets
  end
  -- hull
  shell(v, 6, 2, w - 12, l - 4, 4, 2, ARMY)
  -- camo
  for _, b in ipairs({{12, 12, 4}, {23, 30, 5}, {13, 44, 4}, {25, 50, 3}}) do
    for dy = -b[3], b[3] do for dx = -b[3] - 2, b[3] + 2 do
      if dx * dx / 2 + dy * dy <= b[3] * b[3] then
        local c = v.get(b[1] + dx, b[2] + dy)
        if c == C.G then v.p(b[1] + dx, b[2] + dy, "o") elseif c == C.h then v.p(b[1] + dx, b[2] + dy, "N") end
      end
    end end
  end
  -- front glacis, lights, tow hooks
  v.r(8, 3, w - 16, 1, "H")
  v.r(9, 2, 3, 2, "c"); v.r(w - 12, 2, 3, 2, "c")
  -- driver hatch
  v.r(w // 2 - 3, 6, 6, 5, "K"); v.r(w // 2 - 2, 7, 4, 3, "g")
  -- engine deck
  for y = l - 16, l - 7, 2 do v.r(10, y, w - 20, 1, "K") end
  v.r(8, l - 4, 3, 2, "r"); v.r(w - 11, l - 4, 3, 2, "r")
  -- tool boxes on the fenders
  v.r(7, 20, 3, 10, "n"); v.r(w - 10, 20, 3, 10, "n")
  outline(im, "K")
  return im
end

local function turretImage()
  local im = img(48, 72)
  local cx, cy = 24, 36
  -- barrel (pivot at the cell centre, pointing up)
  rect(im, cx - 2, cy - 34, 4, 26, "d"); rect(im, cx - 2, cy - 34, 1, 26, "m")
  rect(im, cx - 3, cy - 36, 6, 4, "k"); rect(im, cx - 3, cy - 36, 6, 1, "d") -- muzzle brake
  rect(im, cx - 3, cy - 16, 6, 5, "g")                                       -- mantlet
  blob(im, cx, cy + 1, 10, 11, ARMY)
  rect(im, cx - 7, cy + 9, 14, 3, "g")                                        -- bustle
  disc(im, cx + 4, cy + 1, 3, "K"); disc(im, cx + 4, cy + 1, 2, "G")          -- commander hatch
  disc(im, cx - 4, cy + 3, 2, "K")
  rect(im, cx - 8, cy + 6, 1, 1, "l")
  for i = 0, 8 do px(im, cx - 8, cy + 6 + i, "k") end                         -- antenna
  outline(im, "K")
  return im
end

local tank = sheet("tank", 48, 72)
do
  local h0, h1 = hullImage(0), hullImage(2)
  add(tank, "hull", {h0, h1, wreckify(h0)})
  local t = turretImage()
  add(tank, "turret", {t, wreckify(t)})
end
save(tank)


-- ================================================================= PLAYER ==
local player = sheet("player", 16, 16)
local JACKET = {"O", "y", "Y", "c"}
local HAIR = {"K", "n", "N", "o"}

local function person(opts)
  local im = img(16, 16)
  -- feet under the body, visible when striding
  if opts.stepL then disc(im, 5.5, 8.5 + opts.stepL, 1.3, "k") end
  if opts.stepR then disc(im, 10.5, 8.5 + opts.stepR, 1.3, "k") end
  if opts.gun then rect(im, 10, 1, 2, 4, "d"); px(im, 10, 1, "K") end
  local aL, aR = opts.armL or {4.2, 9}, opts.armR or {11.8, 9}
  blob(im, aL[1], aL[2], 1.8, 2.3, JACKET)
  blob(im, aR[1], aR[2], 1.8, 2.3, JACKET)
  px(im, aL[1], aL[2] - 2, "o"); px(im, aR[1], aR[2] - 2, "o")
  blob(im, 8, 9.5, 4.4, 2.9, JACKET)
  sphere(im, 8, 8, 2.7, HAIR)
  outline(im, "K")
  return im
end

add(player, "idle", {person{}})
add(player, "walk", {
  person{stepL=-4, stepR=3,  armL={4.2, 10.5}, armR={11.8, 7.5}},
  person{stepL=-1, stepR=0},
  person{stepL=3,  stepR=-4, armL={4.2, 7.5},  armR={11.8, 10.5}},
  person{stepL=0,  stepR=-1},
}, 120)
add(player, "shoot", {person{gun=true, armR={11, 5}, armL={8.5, 6}}})
do
  local im = img(16, 16)
  disc(im, 8, 9, 6, "r"); disc(im, 10, 11, 3, "r"); disc(im, 5, 11, 2, "R")
  local body = person{armL={1.8, 6}, armR={14.2, 11}, stepL=4, stepR=4}
  im:drawImage(body, Point(0, 0))
  add(player, "dead", {im})
end
save(player)

-- ================================================================== PROPS ==
local props = sheet("props", 16, 16)

local function phone(ringing)
  local im = img(16, 16)
  rect(im, 2, 2, 12, 12, "K")
  rect(im, 3, 3, 10, 10, "E")
  rect(im, 3, 3, 10, 1, "F"); rect(im, 3, 3, 1, 10, "f")
  rect(im, 3, 12, 10, 1, "e"); rect(im, 12, 3, 1, 10, "e")
  art(im, 5, 6, {".xxxx.", "xx..xx", "x....x"})
  art(im, 5, 10, {"xxxxxx"})
  if ringing then
    for _, p in ipairs({{0,0},{1,1},{15,0},{14,1},{0,15},{1,14},{15,15},{14,14},{7,0},{8,0},{7,15},{8,15},{0,7},{0,8},{15,7},{15,8}}) do
      px(im, p[1], p[2], "j")
    end
  end
  return im
end
add(props, "phone", {phone(false), phone(true)}, 250)

do local im = img(16,16)
  blob(im, 8, 8, 3.6, 2.6, {"d", "m", "l", "x"}); outline(im, "K"); px(im, 8, 8, "j"); px(im, 7, 8, "j")
  add(props, "lamp", {im})
end
do local im = img(16,16)
  sphere(im, 8, 8, 3, {"r", "R", "p"}); outline(im, "K"); px(im, 8, 8, "l")
  add(props, "hydrant", {im})
end
do local im = img(16,16)
  rect(im, 1, 5, 14, 6, "K")
  for y = 6, 9 do rect(im, 2, y, 12, 1, (y % 2 == 0) and "o" or "N") end
  add(props, "bench", {im})
end
do local im = img(16,16)
  disc(im, 8, 8, 4.5, "m"); disc(im, 8, 8, 3.2, "k"); px(im, 7, 7, "Y"); px(im, 9, 9, "h"); outline(im, "K")
  add(props, "bin", {im})
end

local ICONS = {
  cash =   {"..G...", ".GGGG.", "GG.G..", ".GGGG.", "..G.GG", "GGGGG.", "..G..."},
  health = {".z.z.", "zzzzz", "zzzzz", ".zzz.", "..z.."},
  pistol = {"KKKKKK", "KllllK", "KKKdKK", "..KdK.", "..KK.."},
  uzi =    {"KKKKKKK", "KmmmmmK", "KKdKdKK", ".KdKK..", ".KK...."},
}
local function crate(icon)
  local im = img(16, 16)
  rect(im, 2, 2, 12, 12, "K")
  rect(im, 3, 3, 10, 10, "o")
  rect(im, 3, 3, 10, 1, "Y"); rect(im, 3, 3, 1, 10, "Y")
  rect(im, 3, 12, 10, 1, "n"); rect(im, 12, 3, 1, 10, "n")
  rect(im, 4, 4, 8, 8, "c")
  local ic = ICONS[icon]
  art(im, 4 + (8 - #ic[1]) // 2, 4 + (8 - #ic) // 2, ic)
  return im
end
for _, n in ipairs({"cash", "health", "pistol", "uzi"}) do add(props, "crate_" .. n, {crate(n)}) end

do local im = img(16,16)
  rect(im, 2, 3, 12, 10, "K"); rect(im, 3, 4, 10, 8, "l"); rect(im, 3, 4, 10, 1, "x")
  disc(im, 7, 8, 3, "d"); px(im, 7, 8, "m"); px(im, 6, 8, "m"); px(im, 8, 8, "m"); px(im, 7, 7, "m"); px(im, 7, 9, "m")
  for y = 5, 10, 2 do rect(im, 11, y, 1, 1, "m") end
  add(props, "ac", {im})
end
do local im = img(16,16)
  rect(im, 4, 4, 8, 8, "K"); rect(im, 5, 5, 6, 6, "m")
  for y = 6, 10, 2 do rect(im, 5, y, 6, 1, "d") end
  add(props, "vent", {im})
end
do local im = img(16,16)
  rect(im, 2, 4, 12, 8, "K"); rect(im, 3, 5, 10, 6, "l"); glass(im, 4, 6, 8, 4)
  add(props, "skylight", {im})
end
do local im = img(16,16)
  for i = 3, 12 do px(im, i, i, "m"); px(im, 15-i, i, "m") end
  disc(im, 8, 8, 2, "l"); px(im, 8, 8, "z")
  add(props, "antenna", {im})
end
do
  local a = img(16,16); ring(a, 8, 8, 5.5, 7.5, "q"); ring(a, 8, 8, 2, 3, "F")
  local b = img(16,16); ring(b, 8, 8, 4.5, 6.5, "F"); ring(b, 8, 8, 1, 2, "q")
  add(props, "marker", {a, b}, 200)
end
local ARROW = {
  ".....K.....",
  "....KLK....",
  "...KLLyK...",
  "..KLLLyyK..",
  ".KLLLLyyyK.",
  "KKKKLLyKKKK",
  "...KLLyK...",
  "...KLLyK...",
  "...KKKKK...",
}
do local im = img(16,16); art(im, 2, 3, ARROW); add(props, "arrow", {im}) end
do
  local down = {}
  for i = #ARROW, 1, -1 do down[#down+1] = ARROW[i] end
  local im = img(16,16); art(im, 2, 4, down, {L="z", y="r"}); add(props, "pointer", {im})
end
local HEART = {".KK.KK.", "KzpKzzK", "KzzzzzK", ".KzzzK.", "..KzK..", "...K..."}
do local im = img(16,16); art(im, 0, 0, HEART); add(props, "heart", {im}) end
do local im = img(16,16); art(im, 0, 0, HEART, {z="d", p="m"}); add(props, "heart_empty", {im}) end
do local im = img(16,16)
  art(im, 2, 4, {".KKKKKK..", "KooooooK.", "KoKoKoKoK", "KooooooK.", "KooooooK.", ".KKKKKK.."})
  add(props, "icon_fist", {im})
end
do local im = img(16,16)
  art(im, 1, 3, {
    ".KKKKKKKKKKKK.",
    ".KxllllllllmK.",
    ".KmmmmmmmmmmK.",
    ".KKKKKmdKKKKK.",
    "....KddK.K....",
    "...KddKKK.....",
    "...KddK.......",
    "...KKKK.......",
  })
  add(props, "icon_pistol", {im})
end
do local im = img(16,16)
  art(im, 0, 3, {
    "KKKKKKKKKKKKKK..",
    "KxllllllllllmK..",
    "KmmmmmmmmmmmmKKK",
    "KKKKKdKKKdKKKK..",
    "...KddK.KdK.....",
    "...KddK.KdK.....",
    "..KddK..KdK.....",
    "..KKKK..KKK.....",
  })
  add(props, "icon_uzi", {im})
end
local function bush()
  local im = img(16,16)
  for _ = 1, 4 do sphere(im, 8 + R(-3,3), 8 + R(-3,3), 3 + R()*1.5, {"g","G","h","H"}, 0.4) end
  sphere(im, 8, 8, 3.5, {"g","G","h","H"}, 0.4)
  outline(im, "g")
  return im
end
add(props, "bush", {bush(), bush()})
do local im = img(16,16)
  rect(im, 4, 4, 8, 8, "r"); disc(im, 8, 8, 3.2, "O"); disc(im, 8, 8, 1.6, "x"); px(im, 8, 8, "O")
  add(props, "cone", {im})
end
do local im = img(16, 16)
  ring(im, 7.5, 7.5, 3.8, 5, "x")
  rect(im, 7, 0, 2, 3, "x"); rect(im, 7, 13, 2, 3, "x"); rect(im, 0, 7, 3, 2, "x"); rect(im, 13, 7, 3, 2, "x")
  rect(im, 7, 7, 2, 2, "z")
  outline(im, "K")
  add(props, "crosshair", {im})
end
do local im = img(16, 16)
  art(im, 1, 1, {
    "K.........", "KK........", "KxK.......", "KxxK......", "KxxxK.....", "KxxxxK....",
    "KxxxxxK...", "KxxxxxxK..", "KxxxxKKKK.", "KxxKxK....", "KxK.KxK...", "KK..KxK...", "K....KK...",
  })
  add(props, "cursor", {im})
end
-- phone app icons: bevelled tile + glyph
local function appIcon(bg, glyph, map)
  local im = img(16, 16)
  rect(im, 1, 1, 14, 14, bg[2]); rect(im, 1, 1, 14, 1, bg[3]); rect(im, 1, 1, 1, 14, bg[3])
  rect(im, 1, 14, 14, 1, bg[1]); rect(im, 14, 1, 1, 14, bg[1])
  art(im, 8 - #glyph[1] // 2, 8 - #glyph // 2, glyph, map)
  outline(im, "K")
  return im
end
add(props, "app_contacts", {appIcon({"e", "E", "f"}, {"..cc..", ".cccc.", ".cccc.", "..cc..", ".cccc.", "cccccc", "cccccc"})})
add(props, "app_messages", {appIcon({"r", "R", "p"}, {"xxxxxxxx", "xKxxxxKx", "xxKxxKxx", "xxxKKxxx", "xxxxxxxx", "xxxxxxxx"})})
add(props, "app_gps", {appIcon({"G", "h", "H"}, {"..zzz..", ".zzzzz.", ".zzxzz.", ".zzzzz.", "..zzz..", "...z...", "...z..."})})
add(props, "app_music", {appIcon({"u", "U", "P"}, {"...cccc", "...c..c", "...c..c", "...c..c", ".ccc.cc", "cccc.cc", ".cc...."})})
-- region props
do local im = img(16, 16)                                   -- round hay bale, top view
  disc(im, 8, 8, 6.5, "y"); ring(im, 8, 8, 2, 2.8, "L"); ring(im, 8, 8, 4.3, 5, "L"); disc(im, 8, 8, 1, "O")
  outline(im, "K"); add(props, "haybale", {im})
end
do local im = img(16, 16)                                   -- mailbox on a post
  rect(im, 5, 5, 6, 8, "K"); rect(im, 6, 6, 4, 6, "B"); rect(im, 6, 6, 4, 1, "C"); rect(im, 10, 6, 2, 3, "z")
  add(props, "mailbox", {im})
end
do local im = img(16, 16)                                   -- pallet
  rect(im, 1, 2, 14, 12, "K")
  for y = 3, 12, 3 do rect(im, 2, y, 12, 2, "o"); rect(im, 2, y, 12, 1, "Y") end
  add(props, "pallet", {im})
end
do local im = img(16, 16)                                   -- oil drum
  sphere(im, 8, 8, 5.5, {"r", "R", "p"}, 0.05); ring(im, 8, 8, 3, 3.8, "r"); disc(im, 10, 6, 1, "K")
  outline(im, "K"); add(props, "barrel", {im})
end
do local im = img(16, 16)                                   -- fuel pump
  rect(im, 3, 2, 10, 12, "K"); rect(im, 4, 3, 8, 10, "x"); rect(im, 4, 3, 8, 3, "R")
  rect(im, 5, 7, 6, 3, "k"); rect(im, 6, 8, 3, 1, "q"); rect(im, 12, 6, 2, 6, "d")
  add(props, "pump", {im})
end
do local im = img(16, 16)                                   -- railway buffer stop
  rect(im, 1, 4, 14, 8, "K"); rect(im, 2, 5, 12, 6, "R")
  for x = 2, 13, 4 do rect(im, x, 5, 2, 6, "x") end
  disc(im, 4, 12, 1.5, "l"); disc(im, 12, 12, 1.5, "l")
  add(props, "buffer", {im})
end
do local im = img(16, 16)                                   -- crate stack
  rect(im, 1, 1, 14, 14, "K"); rect(im, 2, 2, 12, 12, "o")
  rect(im, 2, 7, 12, 2, "N"); rect(im, 7, 2, 2, 12, "N"); rect(im, 2, 2, 12, 1, "Y")
  add(props, "crates", {im})
end
do local im = img(16, 16)                                   -- cow (top view)
  blob(im, 8, 9, 3.6, 6, {"l", "x", "x"})
  disc(im, 6, 8, 1.5, "K"); disc(im, 10, 11, 1.8, "K"); disc(im, 9, 6, 1, "K")
  blob(im, 8, 2.6, 2.2, 2, {"K", "k", "d"}); px(im, 6, 1, "c"); px(im, 10, 1, "c")
  outline(im, "K"); add(props, "cow", {im})
end
save(props)

-- ===================================================================== UI ==
-- Cellphone handset. The game draws the screen contents into the rect
-- x=10 y=20 w=92 h=124 and treats the three bottom buttons as hit areas
-- (see PHONE in src/phone.js) — keep those positions if you repaint it.
local ui = sheet("ui", 112, 176)
do
  local im = img(112, 176)
  local v = V(im, 0, 0)
  rect(im, 84, 0, 8, 8, "k"); rect(im, 85, 0, 2, 7, "d")              -- antenna stub
  shell(v, 4, 4, 104, 170, 10, 10, {"r", "R", "p"})
  for y = 10, 164, 6 do px(im, 6, y, "c") end                          -- edge sheen
  rect(im, 8, 18, 96, 128, "K")                                         -- bezel
  rect(im, 10, 20, 92, 124, "k")                                        -- screen
  rect(im, 44, 9, 24, 4, "r"); for x = 46, 66, 3 do px(im, x, 10, "K"); px(im, x, 11, "K") end -- speaker
  disc(im, 32, 11, 2, "K"); px(im, 31, 10, "C")                         -- camera
  -- call / home / end buttons
  rect(im, 18, 154, 16, 8, "K"); rect(im, 19, 155, 14, 6, "h"); rect(im, 19, 155, 14, 1, "H")
  rect(im, 46, 152, 20, 12, "K"); rect(im, 47, 153, 18, 10, "c"); rect(im, 47, 153, 18, 1, "x"); rect(im, 53, 156, 6, 4, "Y")
  rect(im, 78, 154, 16, 8, "K"); rect(im, 79, 155, 14, 6, "z"); rect(im, 79, 155, 14, 1, "p")
  rect(im, 24, 157, 4, 2, "K"); rect(im, 84, 157, 4, 2, "K")
  rect(im, 108, 40, 2, 18, "r"); rect(im, 108, 64, 2, 10, "r")         -- side keys
  outline(im, "K")
  add(ui, "phone", {im})
end
save(ui)

-- ==================================================================== BIG ==
local big = sheet("big", 48, 48)

local function tree(list, seed, blobs)
  math.randomseed(seed)
  local im = img(48, 48)
  for k = 1, blobs do
    local a = k / blobs * 2 * math.pi + R() * 0.6
    local d = 9 + R() * 3.5
    sphere(im, 24 + math.cos(a) * d, 24 + math.sin(a) * d, 6.5 + R() * 3, list, 0.45)
  end
  sphere(im, 23.5, 23.5, 12, list, 0.4)
  for _ = 1, 10 do
    local x, y = R(12, 26), R(12, 26)
    if opaque(im, x, y) then px(im, x, y, list[#list]); px(im, x + 1, y, list[#list]) end
  end
  outline(im, list[1])
  outline(im, "K")
  return im
end
add(big, "tree_a", {tree({"g", "G", "h", "H"}, 11, 9)})
add(big, "tree_b", {tree({"k", "e", "E", "f", "F"}, 23, 8)})
add(big, "tree_c", {tree({"r", "R", "p", "c"}, 37, 10)})

local function fountain(f)
  local im = img(48, 48)
  disc(im, 24, 24, 21, "m"); disc(im, 24, 24, 20, "l")
  ring(im, 24, 24, 18, 19.5, "x")
  disc(im, 24, 24, 17, "W")
  for k = 0, 3 do
    local r = (f * 4 + k * 5) % 15 + 5
    ring(im, 24, 24, r, r + 0.8, "v")
  end
  disc(im, 24, 24, 5, "l"); disc(im, 23.5, 23.5, 2.5, "x")
  for _ = 1, 16 do
    local a, d = R() * 2 * math.pi, 5 + R() * 5
    px(im, 24 + math.cos(a) * d, 24 + math.sin(a) * d, "V")
  end
  outline(im, "K")
  return im
end
add(big, "fountain", {fountain(0), fountain(1)}, 250)

do local im = img(48, 48)
  sphere(im, 24, 24, 16, {"n", "N", "o", "Y"}, 0.1)
  for r = 4, 15, 4 do ring(im, 24, 24, r, r + 0.7, "n") end
  disc(im, 24, 24, 2, "K")
  outline(im, "K")
  add(big, "watertank", {im})
end
do local im = img(48, 48)
  disc(im, 24, 24, 22, "d"); ring(im, 24, 24, 18, 19.5, "L")
  art(im, 18, 16, {"xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxxxxxxx", "xxxxxxxx",
                   "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx", "xxx..xxx"})
  outline(im, "K")
  add(big, "helipad", {im})
end
do
  local a = img(48, 48); ring(a, 24, 24, 19, 22, "q"); ring(a, 24, 24, 10, 11.5, "F")
  local b = img(48, 48); ring(b, 24, 24, 16, 19, "F"); ring(b, 24, 24, 6, 7.5, "q")
  add(big, "marker", {a, b}, 200)
end
local function shrub(seed)
  math.randomseed(seed)
  local im = img(48, 48)
  for _ = 1, 6 do sphere(im, 24 + R(-6, 6), 24 + R(-5, 5), 4.5 + R() * 2.5, {"g", "G", "h", "H"}, 0.4) end
  outline(im, "g")
  return im
end
add(big, "shrub", {shrub(3), shrub(9)})
-- region big props (48x48)
do local im = img(48, 48)                                   -- grain silo, domed top
  sphere(im, 24, 24, 18, {"d", "m", "l", "x"}, 0.05)
  for r = 6, 16, 5 do ring(im, 24, 24, r, r + 0.6, "m") end
  disc(im, 24, 24, 3, "d"); disc(im, 24, 24, 2, "l")
  outline(im, "K"); add(big, "silo", {im})
end
do local im = img(48, 48)                                   -- fuel storage tank
  disc(im, 24, 24, 22, "m"); disc(im, 24, 24, 21, "x")
  sphere(im, 24, 24, 19, {"l", "x", "x", "c"}, 0.02)
  ring(im, 24, 24, 19.5, 21, "d")
  for i = 0, 7 do local a = i * math.pi / 4; px(im, 24 + math.cos(a) * 20, 24 + math.sin(a) * 20, "L") end
  disc(im, 30, 18, 3, "d"); disc(im, 30, 18, 2, "m")
  rect(im, 23, 3, 2, 21, "d")                               -- stair walkway
  outline(im, "K"); add(big, "fueltank", {im})
end
do local im = img(48, 48)                                   -- backyard pool
  rect(im, 2, 8, 44, 32, "x"); rect(im, 3, 9, 42, 30, "T")
  rect(im, 6, 12, 36, 24, "l"); rect(im, 7, 13, 34, 22, "v")
  for y = 15, 33, 4 do for x = 9, 39, 6 do px(im, x + (y // 4) % 3, y, "V"); px(im, x + 1 + (y // 4) % 3, y, "V") end end
  rect(im, 7, 13, 34, 2, "W")
  rect(im, 36, 12, 1, 5, "m"); rect(im, 39, 12, 1, 5, "m"); rect(im, 36, 14, 4, 1, "m")
  outline(im, "K"); add(big, "pool", {im})
end
do local im = img(48, 48)                                   -- smokestack top
  disc(im, 24, 24, 13, "r"); ring(im, 24, 24, 9, 13, "R"); ring(im, 24, 24, 11, 12, "x")
  disc(im, 24, 24, 8, "K"); disc(im, 23, 23, 5, "k")
  outline(im, "K"); add(big, "smokestack", {im})
end
do local im = img(48, 48)                                   -- hay stack
  for _ = 1, 6 do blob(im, 24 + R(-8, 8), 24 + R(-6, 6), 8 + R() * 3, 7 + R() * 2, {"y", "L", "Y", "c"}, 0.4) end
  outline(im, "N"); add(big, "haystack", {im})
end
save(big)

-- ===================================================================== FX ==
local fx = sheet("fx", 48, 48)
do
  local frames = {}
  for i = 0, 7 do
    local im = img(48, 48)
    local t = i / 7
    local r = 7 + 15 * math.min(1, t * 2.4)
    local list
    if i < 2 then list = {"Y", "j", "c", "x"}
    elseif i < 4 then list = {"O", "y", "Y", "j"}
    elseif i < 6 then list = {"r", "O", "y", "Y"}
    else list = {"k", "d", "m", "l"} end
    for _ = 1, 6 do
      local a, d = R() * 2 * math.pi, r * 0.5
      sphere(im, 24 + math.cos(a) * d, 24 + math.sin(a) * d, r * 0.55, list, 0.5)
    end
    sphere(im, 24, 24, r * 0.8, list, 0.5)
    if i >= 5 then
      for y = 0, 47 do for x = 0, 47 do
        if R() < (i - 4) * 0.22 then im:drawPixel(x, y, CLEAR) end
      end end
    end
    frames[#frames+1] = im
  end
  add(fx, "explode", frames, 70)
end
do
  local frames = {}
  for i = 0, 3 do
    local im = img(48, 48)
    local r = 4 + i * 2.6
    for _ = 1, 3 do sphere(im, 24 + R(-3, 3), 24 + R(-3, 3), r * 0.7, {"d", "m", "l"}, 0.3) end
    sphere(im, 24, 24, r * 0.8, {"d", "m", "l"}, 0.3)
    frames[#frames+1] = im
  end
  add(fx, "smoke", frames, 150)
end
do
  local frames = {}
  for _ = 0, 3 do
    local im = img(48, 48)
    for k = 1, 5 do
      sphere(im, 24 + R(-4, 4), 30 - k * 3 + R(-1, 1), math.max(2, 7.5 - k * 1.1), {"r", "O", "y", "j"}, 0.5)
    end
    frames[#frames+1] = im
  end
  add(fx, "fire", frames, 80)
end
save(fx)


-- =================================================================== FONT ==
-- 5x7 glyphs in 6x8 cells, pure white so the game can tint them.
-- Order must match FONT_CHARS in src/assets.js.
local GLYPHS = {
  A={".###.","#...#","#...#","#####","#...#","#...#","#...#"},
  B={"####.","#...#","#...#","####.","#...#","#...#","####."},
  C={".###.","#...#","#....","#....","#....","#...#",".###."},
  D={"####.","#...#","#...#","#...#","#...#","#...#","####."},
  E={"#####","#....","#....","####.","#....","#....","#####"},
  F={"#####","#....","#....","####.","#....","#....","#...."},
  G={".###.","#...#","#....","#.###","#...#","#...#",".####"},
  H={"#...#","#...#","#...#","#####","#...#","#...#","#...#"},
  I={"#####","..#..","..#..","..#..","..#..","..#..","#####"},
  J={"..###","...#.","...#.","...#.","#..#.","#..#.",".##.."},
  K={"#...#","#..#.","#.#..","##...","#.#..","#..#.","#...#"},
  L={"#....","#....","#....","#....","#....","#....","#####"},
  M={"#...#","##.##","#.#.#","#.#.#","#...#","#...#","#...#"},
  N={"#...#","##..#","#.#.#","#..##","#...#","#...#","#...#"},
  O={".###.","#...#","#...#","#...#","#...#","#...#",".###."},
  P={"####.","#...#","#...#","####.","#....","#....","#...."},
  Q={".###.","#...#","#...#","#...#","#.#.#","#..#.",".##.#"},
  R={"####.","#...#","#...#","####.","#.#..","#..#.","#...#"},
  S={".####","#....","#....",".###.","....#","....#","####."},
  T={"#####","..#..","..#..","..#..","..#..","..#..","..#.."},
  U={"#...#","#...#","#...#","#...#","#...#","#...#",".###."},
  V={"#...#","#...#","#...#","#...#","#...#",".#.#.","..#.."},
  W={"#...#","#...#","#...#","#.#.#","#.#.#","##.##","#...#"},
  X={"#...#","#...#",".#.#.","..#..",".#.#.","#...#","#...#"},
  Y={"#...#","#...#",".#.#.","..#..","..#..","..#..","..#.."},
  Z={"#####","....#","...#.","..#..",".#...","#....","#####"},
  ["0"]={".###.","#...#","#..##","#.#.#","##..#","#...#",".###."},
  ["1"]={"..#..",".##..","..#..","..#..","..#..","..#..",".###."},
  ["2"]={".###.","#...#","....#","...#.","..#..",".#...","#####"},
  ["3"]={"####.","....#","....#",".###.","....#","....#","####."},
  ["4"]={"...#.","..##.",".#.#.","#..#.","#####","...#.","...#."},
  ["5"]={"#####","#....","####.","....#","....#","#...#",".###."},
  ["6"]={".###.","#....","#....","####.","#...#","#...#",".###."},
  ["7"]={"#####","....#","...#.","..#..",".#...",".#...",".#..."},
  ["8"]={".###.","#...#","#...#",".###.","#...#","#...#",".###."},
  ["9"]={".###.","#...#","#...#",".####","....#","....#",".###."},
  [" "]={".....",".....",".....",".....",".....",".....","....."},
  ["$"]={"..#..",".####","#.#..",".###.","..#.#","####.","..#.."},
  [":"]={".....","..#..",".....",".....",".....","..#..","....."},
  ["."]={".....",".....",".....",".....",".....",".....","..#.."},
  [","]={".....",".....",".....",".....",".....","..#..",".#..."},
  ["!"]={"..#..","..#..","..#..","..#..","..#..",".....","..#.."},
  ["?"]={".###.","#...#","....#","...#.","..#..",".....","..#.."},
  ["-"]={".....",".....",".....",".###.",".....",".....","....."},
  ["+"]={".....","..#..","..#..","#####","..#..","..#..","....."},
  ["/"]={"....#","....#","...#.","..#..",".#...","#....","#...."},
  ["%"]={"##..#","##..#","...#.","..#..",".#...","#..##","#..##"},
  ["'"]={"..#..","..#..",".....",".....",".....",".....","....."},
  ["("]={"...#.","..#..",".#...",".#...",".#...","..#..","...#."},
  [")"]={".#...","..#..","...#.","...#.","...#.","..#..",".#..."},
  ["<"]={"...#.","..#..",".#...","#....",".#...","..#..","...#."},
  [">"]={".#...","..#..","...#.","....#","...#.","..#..",".#..."},
  ["*"]={".....",".....","#...#",".#.#.","..#..",".#.#.","#...#"},
  ["\""]={".#.#.",".#.#.",".....",".....",".....",".....","....."},
  ["#"]={".#.#.","#####",".#.#.",".#.#.",".#.#.","#####",".#.#."},
  ["="]={".....",".....","#####",".....","#####",".....","....."},
  ["_"]={".....",".....",".....",".....",".....",".....","#####"},
}
local FONT_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $:.,!?-+/%'()<>*\"#=_"
local font = sheet("font", 6, 8)
do
  local frames = {}
  for i = 1, #FONT_CHARS do
    local ch = FONT_CHARS:sub(i, i)
    local im = img(6, 8)
    art(im, 0, 0, GLYPHS[ch], {["#"]=C.white})
    frames[#frames+1] = im
  end
  add(font, "glyphs", frames)
end
save(font)

-- write the palette for use in Aseprite (Palette > Load)
do
  local f = io.open(app.fs.joinPath(ART, "pastel-city.gpl"), "w")
  if f then
    f:write("GIMP Palette\nName: Pastel City\nColumns: 8\n#\n")
    for _, e in ipairs(PALETTE) do
      local h = e[2]
      f:write(string.format("%3d %3d %3d\t%s\n", tonumber(h:sub(1,2),16), tonumber(h:sub(3,4),16), tonumber(h:sub(5,6),16), e[1]))
    end
    f:close()
  end
end
print("done")
