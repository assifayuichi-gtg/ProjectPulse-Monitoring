const scope=new URL(self.registration.scope);
const shell=new URL('index.html',scope);
const cachePrefix='repair-monitor-shell-';
const cacheName=cachePrefix+'v1';
const assets=[
  'repair-followup.js?v=7',
  'repair-settings.js?v=6.1',
  'repair-report.js?v=5.2',
  'repair-pwa.js?v=1',
  'assets/supabase-2.119.2.js',
  'manifest.webmanifest',
  'icons/repair-192.png',
  'icons/repair-512.png',
  'icons/repair-maskable-512.png',
  'icons/repair-touch-180.png'
];
const versionedScripts=new Set(assets.filter(path=>path.includes('?')).map(path=>new URL(path,scope).pathname));
const fixedAssets=new Set(assets.filter(path=>!path.includes('?')).map(path=>new URL(path,scope).href));

self.addEventListener('install',event=>{
  event.waitUntil((async ()=>{
    const cache=await caches.open(cacheName);
    const requests=[shell.href,...assets.map(asset=>new URL(asset,scope).href)]
      .map(url=>new Request(url,{cache:'reload'}));
    await cache.addAll(requests);
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async ()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith(cachePrefix)&&key!==cacheName).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

function isWorkspace(url){
  return url.origin===scope.origin&&(url.pathname===scope.pathname||url.pathname===shell.pathname);
}

async function cacheResponse(cache,key,response){
  try{await cache.put(key,response.clone());}
  catch{/* A quota or storage error must not block an online response. */}
}

async function serveWorkspace(request,url){
  const cache=await caches.open(cacheName);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),3500);
  try{
    const response=await fetch(request,{signal:controller.signal});
    if(response.ok&&response.headers.get('Content-Type')?.includes('text/html')&&isWorkspace(new URL(response.url))){
      clearTimeout(timeout);
      if(!url.search)await cacheResponse(cache,shell,response);
      return response;
    }
    if(response.status<500)return response;
  }catch{
    // Navigation falls back to the previously saved application shell.
  }finally{clearTimeout(timeout);}
  return await cache.match(shell)||Response.error();
}

async function serveAsset(request,immutable){
  const cache=await caches.open(cacheName);
  const saved=await cache.match(request);
  if(immutable&&saved)return saved;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),3500);
  try{
    const response=await fetch(request,{signal:controller.signal});
    if(response.ok){
      clearTimeout(timeout);
      await cacheResponse(cache,request,response);
      return response;
    }
    return saved||response;
  }catch{
    return saved||Response.error();
  }finally{clearTimeout(timeout);}
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==scope.origin)return;
  if(request.mode==='navigate'&&isWorkspace(url)){
    event.respondWith(serveWorkspace(request,url));
    return;
  }
  if(fixedAssets.has(url.href)||versionedScripts.has(url.pathname)){
    event.respondWith(serveAsset(request,fixedAssets.has(url.href)&&url.pathname!==new URL('manifest.webmanifest',scope).pathname));
  }
});
