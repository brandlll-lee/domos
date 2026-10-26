import type { IncomingMessage, ServerResponse } from "node:http";

export function takeoverFixture() {
  let state: Record<string, unknown> = {};
  return (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === "/takeover-state") {
      if (request.method === "POST") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          state = JSON.parse(body);
          response.end("ok");
        });
      } else {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(state));
      }
      return true;
    }
    if (request.url !== "/takeover-fixture") return false;
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Browser takeover check</title>
<style>body{margin:0;min-height:2000px;font:24px system-ui;background:#f4f4f4;color:#111}input,button{position:absolute;left:160px;width:400px;height:48px;box-sizing:border-box;font:24px system-ui}#draft{top:180px}#next{top:260px}button{top:340px}#hover{position:absolute;left:160px;top:100px}</style>
<style>@keyframes pulse{to{transform:translateX(100px)}}#pulse{position:fixed;top:20px;left:20px;width:20px;height:20px;background:#69a;animation:pulse 1s linear infinite alternate}</style><div id="pulse"></div>
<div id="paint" style="position:fixed;top:20px;left:60px;width:40px;height:40px;background:rgb(20,40,60)"></div><div id="hover">Hover here</div><input id="draft" aria-label="Draft" value="saved draft"><input id="next" aria-label="Next"><button id="confirm">Confirm</button>
<script>
const draft=document.querySelector('#draft'), next=document.querySelector('#next');
let confirmed='',hovered=false,keys=[],clicks=0,scrollDone=0;
function box(node){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}
function report(){fetch('/takeover-state',{method:'POST',body:JSON.stringify({value:draft.value,next:next.value,focused:document.activeElement.id,confirmed,hovered,keys,clicks,scrollY,scrollDone,selection:[draft.selectionStart,draft.selectionEnd],width:innerWidth,height:innerHeight,draft:box(draft),nextBox:box(next),hover:box(document.querySelector('#hover')),confirm:box(document.querySelector('#confirm'))})});}
document.querySelector('#hover').onmouseenter=()=>{hovered=true;report();};
document.querySelector('#confirm').onclick=()=>{clicks++;confirmed=draft.value;report();};
document.addEventListener('input',report);document.addEventListener('keyup',report);document.addEventListener('mouseup',report);document.addEventListener('selectionchange',report);
draft.addEventListener('input',()=>{document.querySelector('#paint').style.background='rgb(20,180,80)';});
document.addEventListener('keydown',e=>{keys.push(e.key);report();});
window.addEventListener('scroll',report);window.addEventListener('load',report);
window.addEventListener('scrollend',()=>{scrollDone++;report();});
</script></html>`);
    return true;
  };
}
