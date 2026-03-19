const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),readline=require('readline');
const RPC_HOST=process.env.BITCOIN_RPC_HOST||'127.0.0.1';
let RPC_PORT=parseInt(process.env.BITCOIN_RPC_PORT||'0');
const SERVER_PORT=parseInt(process.env.PORT||'3000');
const SERVER_HOST=process.env.HOST||'127.0.0.1';

let RPC_USER='',RPC_PASS='';

const COOKIE_CANDIDATES=[
  process.env.BITCOIN_COOKIE_FILE?{port:parseInt(process.env.BITCOIN_RPC_PORT||'8332'),cookie:process.env.BITCOIN_COOKIE_FILE}:null,
  {port:8332, cookie:path.join(os.homedir(),'.bitcoin','.cookie')},
  {port:8332, cookie:path.join(os.homedir(),'Library','Application Support','Bitcoin','.cookie')},
  {port:8332, cookie:path.join(os.homedir(),'snap','bitcoin-core','current','.bitcoin','.cookie')},
  {port:48332,cookie:path.join(os.homedir(),'.bitcoin','testnet4','.cookie')},
  {port:48332,cookie:path.join(os.homedir(),'Library','Application Support','Bitcoin','testnet4','.cookie')},
  {port:48332,cookie:path.join(os.homedir(),'snap','bitcoin-core','current','.bitcoin','testnet4','.cookie')},
  {port:38332,cookie:path.join(os.homedir(),'.bitcoin','signet','.cookie')},
  {port:38332,cookie:path.join(os.homedir(),'Library','Application Support','Bitcoin','signet','.cookie')},
  {port:38332,cookie:path.join(os.homedir(),'snap','bitcoin-core','current','.bitcoin','signet','.cookie')},
  {port:18443,cookie:path.join(os.homedir(),'.bitcoin','regtest','.cookie')},
  {port:18443,cookie:path.join(os.homedir(),'Library','Application Support','Bitcoin','regtest','.cookie')},
  {port:18443,cookie:path.join(os.homedir(),'snap','bitcoin-core','current','.bitcoin','regtest','.cookie')},
  // Windows — %APPDATA%\Bitcoin\ (undefined on Linux/macOS, filtered out below)
  process.env.APPDATA?{port:8332,  cookie:path.join(process.env.APPDATA,'Bitcoin','.cookie')}:null,
  process.env.APPDATA?{port:48332, cookie:path.join(process.env.APPDATA,'Bitcoin','testnet4','.cookie')}:null,
  process.env.APPDATA?{port:38332, cookie:path.join(process.env.APPDATA,'Bitcoin','signet','.cookie')}:null,
  process.env.APPDATA?{port:18443, cookie:path.join(process.env.APPDATA,'Bitcoin','regtest','.cookie')}:null,
].filter(Boolean);

function tryCookie(){
  if(process.env.BITCOIN_RPC_PORT){
    const explicitPort=parseInt(process.env.BITCOIN_RPC_PORT);
    for(const{port,cookie}of COOKIE_CANDIDATES){
      if(port!==explicitPort) continue;
      try{const r=fs.readFileSync(cookie,'utf8').trim(),i=r.indexOf(':');return{user:r.slice(0,i),pass:r.slice(i+1),file:cookie,port};}catch(_){}
    }
    return null;
  }
  // No port set — pick most recently modified cookie (= most recently started node)
  let best=null;
  for(const{port,cookie}of COOKIE_CANDIDATES){
    try{
      const mtimeMs=fs.statSync(cookie).mtimeMs;
      const r=fs.readFileSync(cookie,'utf8').trim(),i=r.indexOf(':');
      if(!best||mtimeMs>best.mtimeMs) best={user:r.slice(0,i),pass:r.slice(i+1),file:cookie,port,mtimeMs};
    }catch(_){}
  }
  return best;
}

// Cache cookie auth for 5s so a full refresh (~30 RPC calls) only hits disk once.
// TTL is short enough to pick up a fresh cookie after bitcoind restarts.
let _authCache=null, _authCacheAt=0;
const AUTH_TTL_MS=5000;
function getAuth(){
  const now=Date.now();
  if(_authCache && now-_authCacheAt < AUTH_TTL_MS) return _authCache;
  const cookie=tryCookie();
  if(cookie){
    if(!process.env.BITCOIN_RPC_PORT) RPC_PORT=cookie.port;
    _authCache={user:cookie.user,pass:cookie.pass};
  } else {
    if(!RPC_PORT) RPC_PORT=8332;
    _authCache={user:RPC_USER,pass:RPC_PASS};
  }
  _authCacheAt=now;
  return _authCache;
}

function prompt(question,hidden=false){
  return new Promise(resolve=>{
    const rl=readline.createInterface({input:process.stdin,output:process.stdout});
    if(hidden){
      process.stdout.write(question);
      process.stdin.setRawMode&&process.stdin.setRawMode(true);
      let val='';
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      const onData=ch=>{
        if(ch==='\u0003'){
          // Ctrl+C — abort cleanly rather than resolving with partial input
          process.stdin.setRawMode&&process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data',onData);
          rl.close();
          process.stdout.write('\n');
          process.exit(0);
        } else if(ch==='\n'||ch==='\r'){
          process.stdin.setRawMode&&process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data',onData);
          process.stdout.write('\n');
          rl.close();
          resolve(val);
        } else if(ch==='\u007f'||ch==='\b'){
          if(val.length>0){val=val.slice(0,-1);process.stdout.write('\b \b');}
        } else if(val.length<256){
          val+=ch;process.stdout.write('*');
        }
      };
      process.stdin.on('data',onData);
    } else {
      rl.question(question,ans=>{rl.close();resolve(ans.trim());});
    }
  });
}

// -- ANSI theme matching the UI --
const A={
  reset:'\x1b[0m',
  orange:'\x1b[38;2;240;112;32m',
  pos:'\x1b[38;2;196;137;74m',
  t1:'\x1b[38;2;232;232;232m',
  t2:'\x1b[38;2;168;168;168m',
  t3:'\x1b[38;2;104;104;104m',
  t4:'\x1b[38;2;64;64;64m',
  grn:'\x1b[38;2;90;170;106m',
  neg:'\x1b[38;2;208;88;88m',
  bold:'\x1b[1m',
};
const c=(col,s)=>col+s+A.reset;
const W=process.stdout.columns||72;
function row(label,value,col=A.t2){process.stdout.write('  '+c(A.t3,(label+':').padEnd(15))+'  '+c(col,value)+'\n');}

function printBanner(){
  const contentWidth=15+2+20; // label col + spacer + value col — matches row() layout
  const barLen=Math.min(Math.max(contentWidth, W-4), 56);
  const bar=c(A.t4,'-'.repeat(barLen));
  process.stdout.write('\n');
  process.stdout.write('  '+c(A.t1,'BLOCKWATCH')+'\n');
  process.stdout.write('  '+bar+'\n');
}

async function loadAuth(){
  if(process.env.BITCOIN_RPC_USER&&process.env.BITCOIN_RPC_PASS){
    RPC_USER=process.env.BITCOIN_RPC_USER;
    RPC_PASS=process.env.BITCOIN_RPC_PASS;
    row('auth','env vars  '+c(A.t4,'('+RPC_USER+')'),A.grn);
    return;
  }
  const cookie=tryCookie();
  if(cookie){
    const netLabel={8332:'mainnet',48332:'testnet4',38332:'signet',18443:'regtest'};
    const net=netLabel[cookie.port]||('port '+cookie.port);
    if(!process.env.BITCOIN_RPC_PORT) RPC_PORT=cookie.port;
    row('auth','cookie  '+c(A.t4,cookie.file),A.grn);
    row('network',net,cookie.port===8332?A.t2:A.pos);
    return;
  }
  process.stdout.write('  '+c(A.pos,'! ')+c(A.t2,'no cookie found — enter RPC credentials')+'\n\n');
  RPC_USER=await prompt('  '+c(A.t3,'rpc user'.padEnd(14))+'  ');
  RPC_PASS=await prompt('  '+c(A.t3,'rpc pass'.padEnd(14))+'  ',true);
  process.stdout.write('\n');
}

const _rpcAgent=new http.Agent({keepAlive:true,maxSockets:8,keepAliveMsecs:3000});

// Static file cache — loaded once at startup, served from memory on every request.
// Avoids a disk read per browser request. To hot-reload during development, restart the server.
const _static={};
function loadStaticFiles(){
  const files=[
    {path:path.join(__dirname,'index.html'),   mime:'text/html',              key:'/index.html'},
    {path:path.join(__dirname,'blockwatch.js'), mime:'application/javascript', key:'/blockwatch.js'},
    {path:path.join(__dirname,'blockwatch.css'),mime:'text/css',               key:'/blockwatch.css'},
  ];
  for(const f of files){
    try{
      _static[f.key]={buf:fs.readFileSync(f.path), mime:f.mime};
    }catch(e){
      console.error('[warn] could not preload '+f.path+': '+e.message);
    }
  }
}
loadStaticFiles();

function rpc(method,params=[]){
  return new Promise((resolve,reject)=>{
    const{user,pass}=getAuth();
    const body=JSON.stringify({jsonrpc:'1.0',id:method,method,params});
    const req=http.request({
      hostname:RPC_HOST,port:RPC_PORT,path:'/',method:'POST',timeout:12000,agent:_rpcAgent,
      headers:{
        'Authorization':'Basic '+Buffer.from(user+':'+pass).toString('base64'),
        'Content-Type':'application/json',
        'Content-Length':Buffer.byteLength(body)
      }
    },(res)=>{
      let raw='';
      res.on('data',c=>raw+=c);
      res.on('end',()=>{
        if(res.statusCode===401)return reject(new Error('401 Unauthorized – check your RPC credentials or cookie file'));
        if(!raw)return reject(new Error('Empty response: '+method));
        try{const j=JSON.parse(raw);if(j.error)return reject(new Error(method+': '+j.error.message));resolve(j.result);}
        catch(e){reject(new Error('Parse failed: '+raw.slice(0,100)));}
      });
    });
    req.on('error',e=>reject(new Error(method+': '+e.message)));
    req.on('timeout',()=>{req.destroy();reject(new Error(method+' timeout'));});
    req.write(body);req.end();
  });
}

const safe=(m,p)=>rpc(m,p).catch(e=>{console.error('[warn]',m,e.message);return null;});

// One fetch at a time — if a second request arrives while one is in flight
// (e.g. two browser tabs, or a slow poll overlapping the next interval),
// return the already-running promise instead of spawning 30+ duplicate RPC calls.
let _fetchPromise=null;
async function fetchAll(){
  if(_fetchPromise) return _fetchPromise;
  _fetchPromise=_doFetchAll().finally(()=>{ _fetchPromise=null; });
  return _fetchPromise;
}
async function _doFetchAll(){
  const[blockchain,networkInfo,mempoolInfo]=await Promise.all([
    safe('getblockchaininfo'),safe('getnetworkinfo'),safe('getmempoolinfo'),
  ]);
  // If getblockchaininfo failed entirely, return a minimal error payload
  // so the client shows the connecting overlay instead of crashing.
  if(!blockchain||typeof blockchain!=='object'||blockchain.blocks==null){
    return{error:'getblockchaininfo unavailable',blockchain:blockchain||{},networkInfo:networkInfo||{},
      mempoolInfo:mempoolInfo||{},peers:[],blocks:[],chainTxStats:{},fees:{},netTotals:{},
      uptime:0,deploymentInfo:{},chainTips:[],ts:Date.now(),rpcNode:RPC_HOST+':'+RPC_PORT};
  }
  const ibd=blockchain.initialblockdownload||false;
  const[peerInfo,netTotals,uptime,deploymentInfo,chainTxStats,chainTips]=await Promise.all([
    safe('getpeerinfo'),safe('getnettotals'),safe('uptime'),safe('getdeploymentinfo'),
    blockchain.blocks>=1?safe('getchaintxstats',[Math.min(2016,blockchain.blocks)]):Promise.resolve(null),
    safe('getchaintips'),
  ]);
  // Skip fee estimates during IBD — estimator hasn't warmed up, data is useless
  const[feeFast,feeMed,feeSlow,feeEco]=ibd
    ?[null,null,null,null]
    :await Promise.all([
      safe('estimatesmartfee',[1]),safe('estimatesmartfee',[6]),
      safe('estimatesmartfee',[144]),safe('estimatesmartfee',[1008]),
    ]);
  const tipHeight=blockchain.blocks;
  // Fewer blocks during IBD to reduce load; skip getblockstats (expensive + meaningless mid-sync)
  const count=Math.min(ibd?8:12,tipHeight+1);
  const heights=Array.from({length:count},(_,i)=>tipHeight-i).filter(h=>h>=0);
  const hashes=heights.length?await Promise.all(heights.map(h=>safe('getblockhash',[h]))):[];
  const[headers,stats]=heights.length?await Promise.all([
    Promise.all(hashes.map(h=>h?safe('getblockheader',[h,true]):null)),
    ibd
      ?Promise.resolve(heights.map(()=>null))
      :Promise.all(hashes.map((h,i)=>h?safe('getblockstats',[heights[i],['txs','total_size','total_weight','time','height','avgfee','avgfeerate','ins','outs','subsidy','totalfee','feerate_percentiles']]):null)),
  ]):[[],[]];
  const blocks=hashes.map((hash,i)=>{
    if(!hash)return null;
    const hdr=headers[i]||{},st=stats[i]||{};
    return{height:hdr.height??heights[i],hash,txs:st.txs??0,size:st.total_size??0,weight:st.total_weight??0,
      time:hdr.time??st.time??0,version:hdr.version??0,bits:hdr.bits??'',nonce:hdr.nonce??0,
      difficulty:hdr.difficulty??0,avgfee:st.avgfee??0,avgfeerate:st.avgfeerate??0,
      ins:st.ins??0,outs:st.outs??0,subsidy:st.subsidy??0,totalfee:st.totalfee??0,
      mediantime:hdr.mediantime??0,chainwork:hdr.chainwork??'',feePercentiles:st.feerate_percentiles??null,};
  }).filter(Boolean);
  const ni=networkInfo||{};
  const safePeers=Array.isArray(peerInfo)?peerInfo:[];
  return{blockchain,networkInfo:ni,mempoolInfo:mempoolInfo||{},peers:safePeers,
    blocks,chainTxStats:chainTxStats||{},
    // conf_target values are included so the client label always matches what was requested.
    // If you change the targets here, the client labels update automatically.
    fees:{
      fast:feeFast?.feerate?Math.round(feeFast.feerate*1e5):null, fast_target:1,
      med: feeMed?.feerate ?Math.round(feeMed.feerate *1e5):null, med_target:6,
      slow:feeSlow?.feerate?Math.round(feeSlow.feerate*1e5):null, slow_target:144,
      eco: feeEco?.feerate ?Math.round(feeEco.feerate *1e5):null, eco_target:1008,
    },
    netTotals:netTotals||{},uptime:uptime||0,deploymentInfo:deploymentInfo||{},chainTips:Array.isArray(chainTips)?chainTips:[],
    minrelaytxfee:ni.minrelaytxfee??null,
    incrementalfee:ni.incrementalfee??null,
    networkWarnings:Array.isArray(ni.warnings)?ni.warnings.join(' '):(ni.warnings||''),
    ts:Date.now(),rpcNode:RPC_HOST+':'+RPC_PORT};
}


// Rate limit /api/data to 5 requests/sec — protects bitcoind from tight loops.
// Uses a simple token bucket: refills 5 tokens/sec, max burst of 5.
// NOTE: this is a GLOBAL limit across all clients, not per-IP. A single browser
// tab polls every 10–30s so the limit is never approached in normal use. With
// multiple tabs open, each tab polls independently but the server deduplicates
// in-flight fetches — only one RPC batch fires regardless of tab count, and all
// tabs share that result. The rate limit is a last-resort guard against tight
// polling loops (e.g. a script hammering /api/data), not a per-user quota.
const _rl={tokens:5,last:Date.now(),rate:5,max:5};
function rateLimitOk(){
  const now=Date.now();
  _rl.tokens=Math.min(_rl.max,_rl.tokens+_rl.rate*(now-_rl.last)/1000);
  _rl.last=now;
  if(_rl.tokens>=1){_rl.tokens--;return true;}
  return false;
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const origin=req.headers.origin||'';
  // CSRF defence: browsers always send an Origin header on cross-origin POST/fetch requests.
  // Rejecting any Origin that isn't localhost means a malicious page open in the same browser
  // cannot POST to this server — even though it's on 127.0.0.1. Do not remove this check.
  if(origin&&!origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)){
    res.writeHead(403);res.end('forbidden');return;
  }
  // Security headers on every response
  res.setHeader('Access-Control-Allow-Origin',origin||'http://localhost');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; "+
    "script-src 'self'; "+
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "+
    "font-src https://fonts.gstatic.com; "+
    "img-src 'self' data:; "+
    "connect-src 'self'; "+
    "frame-ancestors 'none'; "+
    "base-uri 'self'; "+
    "form-action 'self'"
  );
  res.setHeader('Permissions-Policy','camera=(),microphone=(),geolocation=(),payment=()');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(url.pathname==='/health'||url.pathname==='/api/health'){
    let hstatus=200,hbody;
    try{
      const bc=await rpc('getblockchaininfo');
      hbody={ok:true,
        height:bc.blocks??null,
        chain:bc.chain??null,
        synced:!bc.initialblockdownload,
        ibd:bc.initialblockdownload||false,
        progress:bc.verificationprogress!=null?+((bc.verificationprogress)*100).toFixed(3):null,
        headers:bc.headers??null,
        ts:Date.now()};
    }catch(e){
      hstatus=503;
      hbody={ok:false,error:e.message,ts:Date.now()};
    }
    res.writeHead(hstatus,{'Content-Type':'application/json'});
    res.end(JSON.stringify(hbody));
    return;
  }
  if(url.pathname==='/api/data'){
    if(!rateLimitOk()){res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'rate limited'}));return;}
    let data,status=200;
    try{data=await fetchAll();}
    catch(e){console.error('[error]',e.message);data={error:e.message};status=503;}
    res.writeHead(status,{'Content-Type':'application/json'});
    res.end(JSON.stringify(data));
    return;
  }
  if(url.pathname==='/api/rpc'&&req.method==='POST'){
    // SECURITY: this endpoint proxies privileged RPC calls (disconnect, ban).
    // Only allow loopback connections. If you set HOST=0.0.0.0, this dashboard
    // becomes network-accessible — do NOT do that on an untrusted network.
    const remote=req.socket.remoteAddress;
    const isLoopback=(()=>{
      if(!remote) return false;
      if(remote==='::1') return true;
      const ipv4=remote.startsWith('::ffff:')?remote.slice(7):remote;
      const parts=ipv4.split('.');
      if(parts.length!==4) return false;
      const nums=parts.map(Number);
      return nums.every((n,i)=>Number.isInteger(n)&&n>=0&&n<=255)&&nums[0]===127;
    })();
    if(!isLoopback){
      res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'forbidden'}));return;
    }
    let body='',done=false;
    req.on('data',chunk=>{
      if(done)return;
      body+=chunk;
      if(body.length>65536){done=true;res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'request too large'}));}
    });
    req.on('end',async()=>{
      if(done)return;
      done=true;
      let result,status=200;
      try{
        const{method,params}=JSON.parse(body);
        const ALLOWED_METHODS=new Set(['disconnectnode','setban','listbanned']);
        if(!ALLOWED_METHODS.has(method)) throw new Error('method not allowed: '+method);
        result={result:await rpc(method,params||[])};
      }
      catch(e){result={error:e.message};status=500;}
      res.writeHead(status,{'Content-Type':'application/json'});
      res.end(JSON.stringify(result));
    });return;
  }
  const _staticKey=url.pathname==='/'?'/index.html':url.pathname;
  if(_static[_staticKey]){
    const _entry=_static[_staticKey];
    res.writeHead(200,{'Content-Type':_entry.mime,'Cache-Control':'no-store'});
    res.end(_entry.buf);
    return;
  }
  if(_staticKey==='/index.html'||_staticKey==='/blockwatch.js'||_staticKey==='/blockwatch.css'){
    res.writeHead(500);res.end(_staticKey.slice(1)+' not found');
    return;
  }
  res.writeHead(404);res.end('not found');
});

(async()=>{
  printBanner();
  await loadAuth();
  server.listen(SERVER_PORT, SERVER_HOST, ()=>{
    if(SERVER_HOST!=='127.0.0.1'&&SERVER_HOST!=='localhost'){
      row('warning','dashboard exposed on '+SERVER_HOST+' — ensure firewall is set',A.neg);
    }
    row('node',RPC_HOST+':'+RPC_PORT);
    const bar=c(A.t4,'-'.repeat(Math.min(W-4,38)));
    process.stdout.write('  '+bar+'\n');
    row('dashboard', 'http://'+SERVER_HOST+':'+SERVER_PORT, A.pos);
    row('health',    'http://'+SERVER_HOST+':'+SERVER_PORT+'/api/health', A.t3);
    process.stdout.write('\n');
  });
})();

// SIGTERM: sent by systemd, Docker, Umbrel on stop/restart/update
// SIGINT:  sent by Ctrl+C in a terminal
function shutdown(){
  server.close(()=>{
    _rpcAgent.destroy(); // drain keep-alive sockets so the process exits cleanly
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT',  shutdown);
process.on('unhandledRejection',(reason)=>{
  console.error('[unhandled rejection]', reason);
  process.exit(1);
});
process.on('uncaughtException',(err)=>{
  console.error('[uncaught exception]', err);
  process.exit(1);
});