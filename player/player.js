// Replays the asciicast v2 recordings named on the page into xterm.js — the
// same emulator, in its browser build, that resolved the capture, so the last
// frame here is the frame the PNG shows. Replay only: no input reaches the
// terminal, and nothing is ever executed.
import { Terminal } from "./xterm.mjs"

const HOLD_MS = 2500
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

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    term.options.theme = theme()
  })

  let timer
  const apply = ([, code, data]) => {
    if (code === "o") term.write(data)
    else {
      const [cols, rows] = data.split("x").map(Number)
      if (cols && rows) term.resize(cols, rows)
    }
  }

  const stop = () => clearTimeout(timer)

  const play = () => {
    stop()
    term.reset()
    term.resize(header.width, header.height)

    if (reducedMotion.matches) {
      events.forEach(apply)
      return
    }

    const started = performance.now()
    let next = 0
    const step = () => {
      const now = (performance.now() - started) / 1000
      while (next < events.length && events[next][0] <= now) apply(events[next++])
      timer =
        next < events.length
          ? setTimeout(step, (events[next][0] - now) * 1000)
          : setTimeout(play, HOLD_MS)
    }
    step()
  }

  // Start when scrolled into view, and stop when out of it, so a page of
  // several screens is not animating what nobody is looking at.
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) play()
    else stop()
  }).observe(figure)
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
