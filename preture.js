let log = (t) => console.log("[preture]", t)

let cache
cache = cache || {
  set: (url, html) => {
    if (typeof html !== "string")
      throw new Error(`want string, got ${typeof html}`)

    window.localStorage.setItem(url, html)
  },

  get: (url) => {
    return window.localStorage.getItem(url)
  }
}

let HTTP
HTTP = HTTP || {
  // used for inflight requests, we need this to prevent duplicate requests.
  // FIXME: There may be a small race condition, since we request the URL before
  // adding it to inflight, since we need the .text() method to get the promise
  // we add here. This could cause duplicate requests in theory.
  inflight: {}, // url -> Promise

  // http get request
  // returns response as text
  get: async (url, options) => {
    let cached = cache.get(url)
    if (cached) {
      log(`using cache: ${url}`)
      return cached
    }

    let inflight = HTTP.inflight[url]
    if (inflight) {
      log(`using inflight: ${url}`)
      return await inflight
    }

    let textPromise = fetch(url, {
      credentials: "same-origin",
      redirect: "follow",
    }).then(r => {
      if (!r.ok) {
        // TODO: Find a way to remove our event listener from the element we failed to fetch,
        // It could be that the server is preventing fetch() but a browser redirect would work.
        throw new Error(`Bad response: ${r.status}`)
      }

      return r.text()
    }).catch(e => { throw e })

    log(`inflight: ${url}`)
    HTTP.inflight[url] = textPromise
    let text = await textPromise
    cache.set(url, text)
    delete HTTP.inflight[url]

    return text
  },
}


let prefetchAssets = async (html) => {
  // Prefetch scripts
  let x = parsedHTML(html)
  let scripts = x.querySelectorAll("script[src]")
  for (let i = 0; i < scripts.length; i++) {
    const e = scripts[i]
    log(`prefetch: ${e.src}`)
    const js = await HTTP.get(e.src)

    e.text = js
    e.removeAttribute("src")
  }


  // Prefetch stylesheets
  let css = document.createElement("style")

  let stylesheets = x.querySelectorAll(`link[rel="stylesheet"][href]`)
  for (let i = 0; i < stylesheets.length; i++) {
    const e = stylesheets[i]
    const text = await HTTP.get(e.href)
    css.textContent = "\n" + text
    e.parentElement.removeChild(e)
  }

  x.querySelector("head").appendChild(css)
  return x.innerHTML
}

let prefetch = async (url) => {
  const text = await HTTP.get(url)
  log(`prefetch: ${url}`)
  const html = await prefetchAssets(text)

  // Even if it is already cached, ours is better since we used prefetchAssets
  cache.set(url, html)
}

let init = () => {
  log("init")
  // I could do this with `a[href*=${document.location.hostname}]` but
  // with subdomains, eg foo.bob.com should not be cached for bob.com
  // I want to avoid subdomain issues thus I use filter.
  Array.from(document.querySelectorAll("a"))
    .filter(a => parsedURL(a.href).hostname === document.location.hostname)
    .forEach(a => {
      // Register onclick routing
      log(`register onclick: ${a.href}`)
      a.addEventListener("click", e => {
        route(a.href)
        e.preventDefault()
      }, false)

      // Prefetch the link, in case they want to click it
      let cached = cache.get(a.href)
      if (!cached) prefetch(a.href)
    })
}

// parse the string html into an html element using document.createElement
let parsedHTML = (html) => {
  let x = document.createElement("html")
  x.innerHTML = html
  return x
}

let parsedURL = (link) => {
  var a = document.createElement("a")
  a.href = link
  return a
}


// html: <html> object
// replace the current document with html, avoiding flicker
// and executing <script> tags.
let replaceDocument = (html) => {
  document.documentElement.replaceWith(html)
  document.querySelectorAll("script")
    .forEach(e => eval(e.innerText))
}

// html must be an <html> object
let render = (href, html) => {
  // replacing the html document directly with document.documentElement
  // causes flicker, not sure why; but replacing body and head sepeartely works

  // We replace <body> before <head> because <head> loads routes.js,
  // for routes.js to add hooks on every <a> tag it needs the body to be there.
  // <script ... defer> does not work when the body technically is loaded even
  // our new body is not loaded.
  // document.body.replaceWith(html.querySelector("body"))
  // document.head.replaceWith(html.querySelector("head"))
  replaceDocument(html)

  history.pushState(null, "", href)
}

let route = async (href) => {
  let cached = cache.get(href)
  if (cached) {
    log(`cached: ${href}`)
    render(href, parsedHTML(cached))
  } else {
    log(`fetch: ${href}`)
    let html = await HTTP.get(href)
    render(href, parsedHTML(html))
  }

  init()
}

DEBUG = window.location.href.includes("localhost")
if (DEBUG) {
  log("debug: localStorage cache cleared")
  window.localStorage.clear()
}

if (typeof PRETURE_INIT === "undefined") {
  init()
  PRETURE_INIT = true
} else {
  log("already initialized")
}
