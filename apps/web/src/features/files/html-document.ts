const policy =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";

export function htmlDocument(html: string) {
  const bootstrap = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;background:var(--color-background)}body{font-family:var(--font-sans,sans-serif);color:var(--color-text);overflow-wrap:anywhere}*{box-sizing:border-box}button,input,select,textarea{font:inherit}img,svg,canvas{max-width:100%}</style><script>
addEventListener('message',e=>{if(e.source!==parent||e.data?.type!=='domos:file-theme')return;if(e.data.scheme==='dark'||e.data.scheme==='light')document.documentElement.style.colorScheme=e.data.scheme;for(const [key,value]of Object.entries(e.data.values??{})){if(/^--(?:color-[a-z-]+|font-sans)$/.test(key)&&typeof value==='string')document.documentElement.style.setProperty(key,value)}});
document.addEventListener('click',e=>{const link=e.target instanceof Element?e.target.closest('a[href]'):null;if(link&&!link.getAttribute('href')?.startsWith('#'))e.preventDefault()},true);
document.addEventListener('submit',e=>e.preventDefault(),true);
new ResizeObserver(()=>parent.postMessage({type:'domos:file-height',height:document.body?.scrollHeight??0},'*')).observe(document.documentElement);
</script>`;
  const inner = JSON.stringify(bootstrap + html)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; form-action 'none'; base-uri 'none'"><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}iframe{display:block}</style><iframe title="页面内容" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe><script>
const page=document.querySelector('iframe');
page.srcdoc=${inner};
let theme;
page.addEventListener('load',()=>{if(theme)page.contentWindow.postMessage(theme,'*')});
addEventListener('message',e=>{if(e.source===parent&&e.data?.type==='domos:file-theme'){theme=e.data;page.contentWindow.postMessage(theme,'*')}else if(e.source===page.contentWindow&&e.data?.type==='domos:file-height'&&Number.isFinite(e.data.height)){parent.postMessage({type:e.data.type,height:e.data.height},'*')}});
</script>`;
}
