// Only three native surfaces are sampled. Work is independent of conversation
// length: no DOM cloning, media decoding, iframe or page scan.
function readDisplayAppearance() {
  const surfaces = { sidebar: '._2H3hWW_root', composer: '.RlGAzG_card', header: '.Dc7zOa_header' }
  const properties = ['backgroundColor', 'color', 'borderColor', 'borderRadius', 'boxShadow', 'fontFamily']
  const result = {}
  for (const [key, selector] of Object.entries(surfaces)) {
    const source = document.querySelector(selector)
    if (!source || source.closest('.cm-display')) continue
    const style = getComputedStyle(source), value = {}
    for (const property of properties) {
      if (property === 'borderColor' && parseFloat(style.borderTopWidth) === 0) continue
      if (style[property] && !/url\(/i.test(style[property])) value[property] = style[property]
    }
    result[key] = value
    if (key === 'sidebar') {
      const width = source.querySelector('.cm-footer-stack')?.getBoundingClientRect().width
      if (width >= 180 && width <= 420) result.sidebarFooterWidth = width
    }
  }
  return result
}

function useDisplayAppearance() {
  const [appearance, setAppearance] = React.useState({})
  React.useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setAppearance(readDisplayAppearance()))
    }
    update()
    const observer = new MutationObserver(update)
    const options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-ds-dark-theme'] }
    observer.observe(document.documentElement, options)
    observer.observe(document.body, options)
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [])
  return appearance
}
