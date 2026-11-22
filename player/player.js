// Replays the asciicast v2 recordings named on the page into xterm.js — the
// same emulator, in its browser build, that resolved the capture, so the last
// frame here is the frame the PNG shows. Replay only: no input reaches the
// terminal, and nothing is ever executed.
import { Terminal } from "./xterm.mjs"

const SPEEDS = [1, 2]
const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
]

const root = document.documentElement
const token = (name) => getComputedStyle(root).getPropertyValue(name).trim()

// Every colour comes from chrome.css, so the palette has one home.
const theme = () => ({
  background: token("--term-bg"),
  foreground: token("--term-fg"),
  cursor: token("--term-cursor"),
  cursorAccent: token("--term-bg"),
  selectionBackground: token("--term-selection"),
  ...Object.fromEntries(
    ANSI.map((name, i) => [name, token(`--term-ansi-${i}`)]),
  ),
})

export const parseCast = (text) => {
  const [first, ...rest] = text.split("\n").filter((line) => line.trim())
  const header = JSON.parse(first)
  if (header.version !== 2) {
    throw new Error(`unsupported asciicast version ${header.version}`)
  }

  // idle_time_limit shortens long pauses — applied once here so playback
  // only ever deals with final times.
  const limit = header.idle_time_limit
  let shift = 0
  let previous = 0
  const events = []
  for (const line of rest) {
    const [time, code, data] = JSON.parse(line)
    if (limit !== undefined && time - previous > limit) {
      shift += time - previous - limit
    }
    previous = time
    if (code === "o" || code === "r") events.push([time - shift, code, data])
  }
  return { header, events }
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")

// ?capture is how --format gif and mp4 film the page: nothing plays on its
// own, and the recording is stepped from outside, one frame at a time, so the
// result depends on the recording's clock rather than the browser's.
const capturing = new URLSearchParams(location.search).has("capture")

const mount = async (figure) => {
  const host = figure.querySelector(".window-term")
  const response = await fetch(figure.dataset.cast)
  if (!response.ok) throw new Error(`${figure.dataset.cast}: ${response.status}`)
  const { header, events } = parseCast(await response.text())

  const fontSize = Number(token("--term-font-size")) || 14
  const term = new Terminal({
    cols: header.width,
    rows: header.height,
    fontFamily: token("--term-font"),
    fontSize,
    lineHeight: Number(token("--term-line-height")) || 1,
    theme: theme(),
    disableStdin: true,
    cursorBlink: false,
    cursorInactiveStyle: "block",
    scrollback: 0,
  })
  term.open(host)
  // Nothing to type into: keep the hidden textarea out of the tab order.
  host.querySelector("textarea")?.setAttribute("tabindex", "-1")

  // Scale rather than reflow. The recording was made at a fixed size, and
  // re-wrapping it to a phone's width would draw a screen that never existed.
  const fit = () => {
    const screen = term.element.querySelector(".xterm-screen")
    const width = screen.offsetWidth
    const height = screen.offsetHeight
    host.style.setProperty("--term-width", `${width}px`)
    const scale = Math.min(1, host.clientWidth / width)
    term.element.style.transform = scale < 1 ? `scale(${scale})` : ""
    host.style.height = `${Math.ceil(height * scale)}px`
  }
  fit()
  new ResizeObserver(fit).observe(figure.parentElement)

  // Playback runs on the recording's own clock, so pausing and changing speed
  // carry on from the same moment rather than restarting it.
  const controls = {
    toggle: figure.querySelector('[data-action="toggle"]'),
    restart: figure.querySelector('[data-action="restart"]'),
    speed: figure.querySelector('[data-action="speed"]'),
  }
  let timer
  let next = 0
  let position = 0
  let speed = SPEEDS[0]
  let playing = false
  let ticked = 0

  const apply = ([, code, data]) => {
    if (code === "o") term.write(data)
    else {
      const [cols, rows] = data.split("x").map(Number)
      if (cols && rows) term.resize(cols, rows)
    }
  }

  const setPlaying = (value) => {
    playing = value
    figure.dataset.state = value ? "playing" : "paused"
    controls.toggle?.setAttribute("aria-label", value ? "Pause" : "Play")
  }

  const rewind = () => {
    term.reset()
    term.resize(header.width, header.height)
    next = 0
    position = 0
  }

  const advance = () => {
    const now = performance.now()
    position += ((now - ticked) / 1000) * speed
    ticked = now
  }

  const step = () => {
    advance()
    while (next < events.length && events[next][0] <= position) apply(events[next++])
    if (next < events.length) {
      timer = setTimeout(step, ((events[next][0] - position) / speed) * 1000)
    } else {
      setPlaying(false)
    }
  }

  const play = () => {
    clearTimeout(timer)
    if (next >= events.length) rewind()
    setPlaying(true)
    ticked = performance.now()
    step()
  }

  const pause = () => {
    if (!playing) return
    clearTimeout(timer)
    advance()
    setPlaying(false)
  }

  // Before anything plays, the window holds the last frame: the screen the
  // PNG shows, never an empty terminal.
  const showLast = () => {
    rewind()
    events.forEach(apply)
    next = events.length
    setPlaying(false)
  }

  controls.toggle?.addEventListener("click", () => (playing ? pause() : play()))
  controls.restart?.addEventListener("click", () => {
    rewind()
    play()
  })
  controls.speed?.addEventListener("click", () => {
    if (playing) advance()
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    const other = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
    controls.speed.textContent = `${speed}×`
    controls.speed.setAttribute(
      "aria-label",
      `Playback speed ${speed}×, switch to ${other}×`,
    )
    if (playing) {
      clearTimeout(timer)
      step()
    }
  })

  if (capturing) {
    rewind()
    window.cliShotCapture = {
      times: events.map(([time]) => time),
      // Applies events up to `count`, then waits for xterm to parse them and
      // for two frames to paint, so a screenshot taken next shows them.
      until: (count) =>
        new Promise((resolve) => {
          while (next < count) apply(events[next++])
          term.write("", () =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          )
        }),
    }
    figure.dataset.capture = "ready"
    return
  }

  showLast()

  // Plays once, the first time it scrolls into view, and never on its own
  // under reduced motion. Leaving view mid-play pauses it; coming back resumes.
  let autoplayed = false
  let pausedByScroll = false
  new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        if (!autoplayed && !reducedMotion.matches) {
          autoplayed = true
          rewind()
          play()
        } else if (pausedByScroll) {
          pausedByScroll = false
          play()
        }
      } else if (playing) {
        pausedByScroll = true
        pause()
      }
    },
    { threshold: 0.5 },
  ).observe(figure)
}

const start = async () => {
  // xterm measures its cell from the font in place when it opens; measuring
  // before the icon font arrives would size the grid against a fallback.
  const size = `${token("--term-font-size") || 14}px`
  await Promise.allSettled([
    document.fonts.load(`${size} "Symbols Nerd Font Mono"`, ""),
    document.fonts.load(`${size} ${token("--term-font")}`, "W"),
  ])

  for (const figure of document.querySelectorAll(".window[data-cast]")) {
    mount(figure).catch((error) => {
      figure.querySelector(".window-term").textContent =
        `Could not load this recording (${error.message}).`
      console.error(error)
    })
  }
}

start()
