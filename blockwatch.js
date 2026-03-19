(function () {
'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// UTILS — pure helpers, no DOM, no state
// ═══════════════════════════════════════════════════════════════════════════════
const utils = {
  f:   (n, d=1) => (+n||0).toFixed(d),
  fb:  n => (+n||0).toLocaleString('en-US'),
  set: (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; },
  esc: s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),

  fmtBytes(b){
    b=+b||0;
    const neg=b<0; const a=Math.abs(b); const s=neg?'-':'';
    if(a>=1e12) return s+this.f(a/1e12,2)+' TB';
    if(a>=1e9)  return s+this.f(a/1e9, 2)+' GB';
    if(a>=1e6)  return s+this.f(a/1e6, 2)+' MB';
    if(a>=1e3)  return s+this.f(a/1e3, 1)+' KB';
    return s+a+' B';
  },
  fmtRate(b){
    b=+b||0;
    if(b>=1e6) return this.f(b/1e6,2)+' MB/s';
    if(b>=1e3) return this.f(b/1e3,1)+' KB/s';
    return b.toFixed(0)+' B/s';
  },
  fmtAge(s){
    s=Math.max(0,Math.floor(+s||0));
    if(s<60)    return s+'s';
    if(s<3600)  return Math.floor(s/60)+'m '+Math.floor(s%60)+'s';
    if(s<86400) return Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m';
    return Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h';
  },
  fmtAgeAgo(s){ return this.fmtAge(s)+' ago'; },
  fmtUptime(s){
    s=+s||0;
    const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
    return d?`${d}d ${h}h`:h?`${h}h ${m}m`:`${m}m`;
  },
  fmtDiff(d){
    d=+d||0;
    if(d>=1e12) return this.f(d/1e12,3)+' T';
    if(d>=1e9)  return this.f(d/1e9, 3)+' G';
    if(d>=1e6)  return this.f(d/1e6, 2)+' M';
    return this.fb(d);
  },
  fmtHR(diff, medianBlockSecs){
    // Use actual observed block interval when available; fall back to 600s target.
    // diff * 2^32 / blocktime gives the expected hashes per second at this difficulty.
    const t=medianBlockSecs>0?medianBlockSecs:600;
    const hr=(+diff||0)*Math.pow(2,32)/t;
    if(hr>=1e18) return this.f(hr/1e18,2)+' EH/s';
    if(hr>=1e15) return this.f(hr/1e15,2)+' PH/s';
    if(hr>=1e12) return this.f(hr/1e12,2)+' TH/s';
    return this.f(hr/1e9,2)+' GH/s';
  },
  fmtSats(sats){
    sats=Math.round(+sats||0);
    if(sats>=1e5) return this.f(sats/1e8,4)+' BTC';
    return sats+' sat';
  },
  fmtTimestamp(t){
    if(!t) return '—';
    return new Date(t*1000).toISOString().replace('T',' ').slice(0,19)+' UTC';
  },
  fmtBanLeft(entry){
    const left=entry.banned_until?entry.banned_until-Date.now()/1000:0;
    if(left<=0)          return 'expired';
    if(left>315360000)   return '∞ permanent';
    if(left<3600)        return Math.ceil(left/60)+'m left';
    if(left<86400)       return Math.ceil(left/3600)+'h left';
    return Math.ceil(left/86400)+'d left';
  },
  peerNet(addr, network){
    if(network) return network;
    if(!addr)   return 'unknown';
    if(addr.endsWith('.onion'))               return 'onion';
    if(addr.includes('.i2p'))                 return 'i2p';
    if(addr.startsWith('['))                  return 'ipv6';
    if(addr.includes(':')&&!addr.includes('.')) return 'ipv6';
    return 'ipv4';
  },
  decodeServices(h){
    const n=parseInt(h||'0',16);
    const s=[];
    if(n&0x1)   s.push('NETWORK');
    if(n&0x2)   s.push('GETUTXO');
    if(n&0x4)   s.push('BLOOM');
    if(n&0x8)   s.push('WITNESS');
    if(n&0x10)  s.push('XTHIN');
    if(n&0x40)  s.push('COMPACT_FILTERS');
    if(n&0x400) s.push('NETWORK_LIMITED');
    if(n&0x800) s.push('P2P_V2');
    return s.length?s:['NONE'];
  },
  mspaceUrl(hash, chain){
    const p={testnet4:'testnet4/',signet:'signet/'};
    const safeHash=/^[0-9a-fA-F]{64}$/.test(hash||'')?hash:'';
    return 'https://mempool.space/'+(p[chain]||'')+'block/'+safeHash;
  },
  copyToClipboard(text, el){
    navigator.clipboard.writeText(text).then(()=>{
      if(el){ el.classList.add('copy-flash'); setTimeout(()=>el.classList.remove('copy-flash'),500); }
    }).catch(()=>{});
  },
};

// AbortSignal.timeout polyfill (Safari < 16.4)
if(!AbortSignal.timeout){
  AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('TimeoutError','TimeoutError')),ms);return c.signal;};
}

// Convenience aliases used throughout
const {f, fb, set, esc} = utils;


// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK MODULE — bandwidth history + sparkline
// ═══════════════════════════════════════════════════════════════════════════════
const network = {
  _histSent: Array(52).fill(0),
  _histRecv: Array(52).fill(0),

  push(sentRate, recvRate){
    this._histSent.push(sentRate);
    this._histRecv.push(recvRate);
    if(this._histSent.length>52) this._histSent.shift();
    if(this._histRecv.length>52) this._histRecv.shift();
  },

  render(netIn, netOut, totalRecv, totalSent){
    const maxBW=Math.max(Math.max(...this._histSent,...this._histRecv),1);
    document.getElementById('bw-up-fill').style.width=Math.min(100,(netOut||0)/maxBW*100)+'%';
    document.getElementById('bw-dn-fill').style.width=Math.min(100,(netIn||0)/maxBW*100)+'%';
    set('bw-up-v', utils.fmtRate(netOut||0));
    set('bw-dn-v', utils.fmtRate(netIn||0));
    set('bw-rv',   utils.fmtBytes(totalRecv||0));
    set('bw-sn',   utils.fmtBytes(totalSent||0));
    this._drawSpark();
  },

  _drawSpark(){
    const c=document.getElementById('spark');
    if(!c) return;
    const dpr=window.devicePixelRatio||1;
    const cssW=Math.max(40,(c.parentElement?.getBoundingClientRect().width||c.offsetWidth||180)-26);
    const cssH=48;
    c.width=Math.round(cssW*dpr); c.height=Math.round(cssH*dpr);
    c.style.width=cssW+'px'; c.style.height=cssH+'px';
    const ctx=c.getContext('2d'), W=cssW, H=cssH;
    ctx.save(); ctx.scale(dpr,dpr);
    ctx.clearRect(0,0,W,H);

    const mx=Math.max(...this._histSent,...this._histRecv,1);
    const pad=3;

    const drawLine=(hist, color, fillColor)=>{
      const pts=hist.map((v,i)=>({
        x: i/(hist.length-1)*W,
        y: H-pad-(v/mx)*(H-pad*2),
      }));

      // Filled area under line
      if(fillColor){
        ctx.beginPath();
        ctx.moveTo(pts[0].x, H);
        pts.forEach(p=>ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length-1].x, H);
        ctx.closePath();
        ctx.fillStyle=fillColor;
        ctx.fill();
      }

      // Line stroke
      ctx.beginPath();
      pts.forEach((p,i)=>i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y));
      ctx.strokeStyle=color;
      ctx.lineWidth=1.5;
      ctx.lineJoin='round';
      ctx.stroke();

      // Endpoint dot
      const last=pts[pts.length-1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 2, 0, Math.PI*2);
      ctx.fillStyle=color;
      ctx.fill();
    };

    // Draw recv (orange) then sent (pos/amber) on top
    drawLine(this._histRecv, 'rgba(240,112,32,.9)',  'rgba(240,112,32,.07)');
    drawLine(this._histSent, 'rgba(196,137,74,.75)', 'rgba(196,137,74,.05)');

    // Y-axis label: peak rate
    const peak=utils.fmtRate(mx);
    ctx.font=`${7*dpr/dpr}px JetBrains Mono, monospace`;
    ctx.fillStyle='rgba(64,64,64,.9)';
    ctx.textAlign='right';
    ctx.fillText(peak, W-1, 9);

    ctx.restore();
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// NODE MODULE — node panel, titlebar, mempool, retarget, sync, services, local addrs
// ═══════════════════════════════════════════════════════════════════════════════
const nodePanel = {
  _currentChain: 'main',
  _retargetHistory: [],
  _syncHistory: [],
  _localAddrsRevealed: false,
  _lastLocalAddrs: [],

  // Exposed so peers/blocks modules can use chain-aware mempool links
  get currentChain(){ return this._currentChain; },

  render(d){
    const bc  = d.blockchain||{};
    const ni  = d.networkInfo||{};
    const mi  = d.mempoolInfo||{};
    const cts = d.chainTxStats||{};
    const blocks = d.blocks||[];
    const now = Date.now()/1000;

    this._renderTitlebar(bc, ni, d.uptime, blocks, d);
    this._renderNodeInfo(bc, ni, d.rpcNode, blocks, now);
    this._renderChainTips(d.chainTips||[]);
    this._renderRetarget(bc.blocks||0, bc.mediantime||0, cts);
    this._renderConsensus(bc, cts);
    this._renderMempool(mi, d);
    this._renderStorage(bc);
    this._renderNetworkReachability(ni);
    this._renderServices(ni);
    this._renderLocalAddrs(ni.localaddresses||[]);

    if(bc.initialblockdownload){
      this._updateSync(bc.verificationprogress||0);
    }
  },

  _renderTitlebar(bc, ni, uptime, blocks, d={}){
    const synced = (bc.verificationprogress||0)>=.9999;
    const pct    = (bc.verificationprogress||0)*100;

    set('tb-ver', (ni.subversion||'').replace(/^\/|\/$/g,''));
    set('tb-height', '#'+fb(bc.blocks||0));

    const syncEl=document.getElementById('tb-sync');
    if(syncEl){
      if(synced){
        syncEl.textContent='Synced'; syncEl.className='tb-sync-badge synced';
      } else {
        syncEl.textContent='Syncing'; syncEl.className='tb-sync-badge syncing';
      }
      syncEl.style.display='';
    }

    // Chain accent class — swaps CSS colour vars for non-mainnet chains
    this._currentChain=bc.chain||'main';
    const chainNameMap={'testnet4':'testnet4','signet':'signet','regtest':'regtest'};
    const chainClass='chain-'+(chainNameMap[bc.chain]||bc.chain||'main');
    document.documentElement.className=bc.chain&&bc.chain!=='main'?chainClass:'';

    // Swap favicon to match chain accent colour
    const faviconColors={'testnet4':'#3a8fd4','signet':'#c8a820','regtest':'#9a5cc8','test':'#3a8fd4'};
    const fColor=faviconColors[bc.chain]||'#f07020';
    const fSvg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${fColor}"/></svg>`;
    const fEl=document.querySelector('link[rel="icon"]')||Object.assign(document.createElement('link'),{rel:'icon'});
    fEl.type='image/svg+xml';
    fEl.href='data:image/svg+xml,'+encodeURIComponent(fSvg);
    if(!fEl.parentNode) document.head.appendChild(fEl);

    document.getElementById('live-dot').className='dot ok';

    // Update page title — visible in tab, history, task switcher, pinned tabs
    const chainLabel=bc.chain&&bc.chain!=='main'?' · '+bc.chain:'';
    document.title='#'+fb(bc.blocks||0)+chainLabel+' · blockwatch';

    // Node warnings banner
    const warnEl=document.getElementById('node-warnings');
    if(warnEl){
      const chainWarns=Array.isArray(bc.warnings)?bc.warnings.join(' '):((bc.warnings||'').trim());
      // Also surface network-layer warnings (e.g. unknown softfork detected)
      const netWarns=(d.networkWarnings||'').trim();
      const warns=[chainWarns,netWarns].filter(Boolean).join(' · ');
      warnEl.textContent=warns?'⚠ '+warns:'';
      warnEl.style.display=warns?'block':'none';
    }

    // Uptime
    const tbUptime=document.getElementById('tb-uptime');
    const tbUptimeSep=document.getElementById('tb-uptime-sep');
    if(tbUptime){
      if(uptime){ tbUptime.textContent='up '+utils.fmtUptime(uptime); tbUptime.style.display=''; if(tbUptimeSep) tbUptimeSep.style.display=''; }
      else { tbUptime.style.display='none'; if(tbUptimeSep) tbUptimeSep.style.display='none'; }
    }
  },

  _renderNodeInfo(bc, ni, rpcNode, blocks, now){
    const synced=(bc.verificationprogress||0)>=.9999;
    const pct=(bc.verificationprogress||0)*100;
    const chainDisplayName={'main':'mainnet','testnet4':'testnet4','signet':'signet','regtest':'regtest'};
    const tipTime=blocks.length?blocks[0].time:0;

    set('ni-net',  chainDisplayName[bc.chain]||bc.chain||'—');
    set('ni-h',    fb(bc.blocks||0));
    set('ni-hd',   fb(bc.headers||0));
    const hdRow=document.getElementById('ni-hd-row');
    if(hdRow) hdRow.style.display=(bc.headers&&bc.headers!==bc.blocks)?'':'none';
    set('ni-sync', synced?'100.0000%':pct.toFixed(4)+'%');
    set('ni-ta',   tipTime?utils.fmtAgeAgo(now-tipTime):'—');
    set('ni-mt',   bc.mediantime?utils.fmtTimestamp(bc.mediantime):'—');
    set('ni-sync',  bc.initialblockdownload?'active':'complete');
    set('ni-pv',   ni.protocolversion!=null?String(ni.protocolversion):'—');
    set('ni-conn', ni.connections!=null?(ni.connections+(ni.maxconnections?(' / '+ni.maxconnections):'')):'—');
    // in/out split — shown as e.g. '8↓ · 4↑'
    const splitEl=document.getElementById('ni-conn-split');
    if(splitEl){
      const cin=ni.connections_in!=null?ni.connections_in:null;
      const cout=ni.connections_out!=null?ni.connections_out:null;
      splitEl.textContent=(cin!=null&&cout!=null)?(cin+'↓ '+cout+'↑'):'—';
    }
    set('ni-rf',   ni.relayfee!=null?f(ni.relayfee*1e5,2)+' sat/vB':'—');
    set('ni-rpc',  rpcNode||'—');

    const syncSec=document.getElementById('sync-section');
    if(syncSec) syncSec.style.display=bc.initialblockdownload?'block':'none';
  },

  _renderChainTips(tips){
    const tipsEl=document.getElementById('ni-tips');
    if(!tipsEl) return;
    if(!tips.length){ tipsEl.textContent='—'; tipsEl.className='v dim'; return; }

    const active    =tips.filter(t=>t.status==='active').length;
    const deepForks =tips.filter(t=>t.status==='valid-fork'&&t.branchlen>1);
    const orphans   =tips.filter(t=>t.status==='valid-fork'&&t.branchlen===1);
    const validHdr  =tips.filter(t=>t.status==='valid-headers');
    const invalid   =tips.filter(t=>t.status==='invalid');

    // Summary label
    if(deepForks.length){
      tipsEl.textContent=deepForks.length+' fork'+(deepForks.length>1?'s':'')+' ('+deepForks.map(t=>t.branchlen+'blk').join(', ')+')';
      tipsEl.className='v neg';
    } else if(invalid.length){
      tipsEl.textContent=invalid.length+' invalid'; tipsEl.className='v neg';
    } else if(validHdr.length){
      tipsEl.textContent=validHdr.length+' valid-headers'; tipsEl.className='v o';
    } else if(orphans.length){
      tipsEl.textContent=orphans.length+' orphan'+(orphans.length>1?'s':''); tipsEl.className='v dim';
    } else {
      tipsEl.textContent=tips.length+' tip'+(tips.length>1?'s':'')+' · '+active+' active'; tipsEl.className='v dim';
    }

    // Expanded tip list — show all non-active tips with height and truncated hash
    const nonActive=[...deepForks,...invalid,...validHdr,...orphans];
    let tipListEl=document.getElementById('ni-tips-list');
    if(!tipListEl){
      tipListEl=document.createElement('div');
      tipListEl.id='ni-tips-list';
      tipsEl.closest('.kv').after(tipListEl);
    }
    if(!nonActive.length){ tipListEl.innerHTML=''; return; }
    tipListEl.innerHTML=nonActive.map(t=>{
      const statusCls=t.status==='invalid'?'neg':t.status==='valid-fork'&&t.branchlen>1?'neg':t.status==='valid-headers'?'o':'dim';
      const hash=t.hash||'';
      const hashShort=hash?`<em>${hash.slice(0,4)}</em>${hash.slice(4,8)}…${hash.slice(-4)}`:'—';
      const copySpan=hash?`<span data-copy="${esc(hash)}" class="copy-icon">⎘</span>`:'';
      return `<div class="tip-row">
        <span class="tip-height">#${fb(t.height||0)}</span>
        <span class="tip-hash td-hash">${hashShort}${copySpan}</span>
        <span class="tip-status ${statusCls}">${esc(t.status||'')}</span>
        ${t.branchlen>0?`<span class="tip-branch">${t.branchlen}blk</span>`:''}
      </div>`;
    }).join('');
  },

  _renderConsensus(bc, cts){
    const diffVal=bc.difficulty||0;
    set('mn-df', utils.fmtDiff(diffVal));
    set('mn-hr', utils.fmtHR(diffVal, this._avgBlockSecs||0));
    set('mn-ph', utils.fmtHR(diffVal, this._avgBlockSecs||0));
    const cw=bc.chainwork||'';
    set('mn-cw', cw?'…'+cw.slice(-12):'—');
    const cwCopy=document.getElementById('mn-cw-copy');
    if(cwCopy){ cwCopy.dataset.copy=cw; cwCopy.style.display=cw?'':'none'; }
    set('mn-tps', cts.txrate?f(cts.txrate,2)+' tx/s':'—');
    set('mn-ttx', cts.txcount?fb(cts.txcount):'—');
  },

  _renderRetarget(height, mediantime, cts){
    const INTERVAL=2016, TARGET=600;
    const posInPeriod=height%INTERVAL;
    const nextRetarget=height+(INTERVAL-posInPeriod);
    const blocksLeft=nextRetarget-height;

    set('mn-rt-blk',  fb(nextRetarget));
    set('mn-rt-left', fb(blocksLeft)+' blocks');

    if(mediantime&&height){
      const periodStart=height-posInPeriod;
      if(this._retargetHistory.length&&(this._retargetHistory[0].height<periodStart||posInPeriod===0)){
        this._retargetHistory=[];
      }
      if(!this._retargetHistory.length||this._retargetHistory[this._retargetHistory.length-1].height!==height){
        this._retargetHistory.push({height,time:mediantime});
        if(this._retargetHistory.length>120) this._retargetHistory.shift();
      }
    }

    // Prefer chainTxStats window data — gives accurate avg immediately on first load.
    // window_interval / window_block_count = observed seconds per block over last 2016 blocks.
    let avgSec=TARGET;
    if(cts&&cts.window_interval>0&&cts.window_block_count>0){
      avgSec=cts.window_interval/cts.window_block_count;
    } else if(this._retargetHistory.length>=2){
      const newest=this._retargetHistory[this._retargetHistory.length-1];
      const oldest=this._retargetHistory[0];
      const dh=newest.height-oldest.height;
      const dt=newest.time-oldest.time;
      if(dh>0&&dt>0) avgSec=dt/dh;
    }
    this._avgBlockSecs=avgSec; // used by _renderConsensus for accurate hashrate

    const estSecs=blocksLeft*avgSec;
    const estDate=new Date(Date.now()+estSecs*1000);
    set('mn-rt-date', estDate.toISOString().slice(0,10)+' ~'+estDate.toISOString().slice(11,16)+' UTC');

    const pctChange=((TARGET/avgSec)-1)*100;
    const chgEl=document.getElementById('mn-rt-chg');
    if(chgEl){
      const sign=pctChange>=0?'+':'';
      const arrow=pctChange>1?' ↑':pctChange<-1?' ↓':'';
      chgEl.textContent=sign+pctChange.toFixed(2)+'%'+arrow;
      chgEl.className='v '+(pctChange>1?'o':pctChange<-1?'grn':'dim');
    }
    set('mn-rt-avg', (avgSec/60).toFixed(2)+' min/block');
  },

  _renderMempool(mi, d={}){
    const mpFee=mi.mempoolminfee||0;
    const uPct=mi.usage&&mi.maxmempool?mi.usage/mi.maxmempool*100:0;
    const mpLoaded=document.getElementById('mp-loaded');
    const mpLoadingRow=document.getElementById('mp-loading-row');
    // Only surface the loaded row when mempool is NOT ready — steady state is silent
    if(mpLoaded){
      if(mi.loaded===false){
        mpLoaded.innerHTML='<span class="fork-badge defined">loading…</span>';
        mpLoaded.className='v';
        if(mpLoadingRow) mpLoadingRow.style.display='';
      } else {
        if(mpLoadingRow) mpLoadingRow.style.display='none';
      }
    }
    set('mp-txs',    fb(mi.size||0));
    set('mp-sz',     utils.fmtBytes(mi.bytes||0));
    set('mp-us',     utils.fmtBytes(mi.usage||0)+' ('+f(uPct,1)+'%)');
    set('mp-mf',     mpFee?f(mpFee*1e5,2)+' sat/vB':'—');
    set('mp-tf',     mi.total_fee?utils.fmtSats(Math.round(mi.total_fee*1e8)):'—');
    // relay fee vs incremental fee (BIP125 RBF bump minimum) — passed up from server
    const rfEl=document.getElementById('mp-rf');
    const incrEl=document.getElementById('mp-incrf');
    if(rfEl)  rfEl.textContent=d.minrelaytxfee!=null?f(d.minrelaytxfee*1e5,2)+' sat/vB':'—';
    if(incrEl) incrEl.textContent=d.incrementalfee!=null?f(d.incrementalfee*1e5,2)+' sat/vB':'—';
    // Colour unbroadcast badge: orange if >0
    const unconfEl=document.getElementById('mp-unconf');
    if(unconfEl){
      const ub=mi.unbroadcastcount??0;
      unconfEl.textContent=ub>0?ub+' unbroadcast':'none';
      unconfEl.className='v '+(ub>0?'o':'dim');
    }
    const mpRbfEl=document.getElementById('mp-fullrbf');
    if(mpRbfEl) mpRbfEl.innerHTML=mi.fullrbf===true?'<span class="fork-badge active">enabled</span>':mi.fullrbf===false?'<span class="fork-badge defined">disabled</span>':'—';
  },

  _renderStorage(bc){
    set('ni-sz', bc.size_on_disk?utils.fmtBytes(bc.size_on_disk):'—');
    set('ni-pr', bc.pruned?'yes':'no');
    const pruneRow=document.getElementById('ni-pruneheight-row');
    if(pruneRow) pruneRow.style.display=bc.pruned?'':'none';
    if(bc.pruned&&bc.pruneheight!=null) set('ni-pruneheight','#'+fb(bc.pruneheight));
  },

  _renderNetworkReachability(ni){
    const el=document.getElementById('ni-reachability');
    if(!el) return;
    const nets=ni.networks||[];
    if(!nets.length){
      el.innerHTML='<span style="font-size:9px;color:var(--t4);padding:2px 0;display:block">—</span>';
      return;
    }
    const ORDER=['ipv4','ipv6','onion','i2p','cjdns'];
    const sorted=[...nets].sort((a,b)=>{
      const ai=ORDER.indexOf(a.name); const bi=ORDER.indexOf(b.name);
      return (ai<0?99:ai)-(bi<0?99:bi);
    });
    // Build cell HTML for each network
    const cells=sorted.map(n=>{
      const reachable=n.reachable===true;
      const limited=n.limited===true&&!reachable;
      const statusLabel=reachable?'reachable':limited?'limited':'off';
      const proxyStr=n.proxy?`<div class="reach-proxy">${esc(n.proxy)}</div>`:'';
      return `<div class="reach-cell">
        <div class="reach-cell-top">
          <span class="reach-net reach-${reachable?'on':limited?'lim':'off'}">${esc(n.name)}</span>
          <span class="reach-status">${statusLabel}</span>
        </div>
        ${proxyStr}
      </div>`;
    });
    // Pair into rows of 2
    const rows=[];
    for(let i=0;i<cells.length;i+=2){
      rows.push(`<div class="reach-row">${cells[i]}${cells[i+1]||''}</div>`);
    }
    el.innerHTML=rows.join('');
  },

  _renderServices(ni){
    const svcs=ni.localservicesnames||[];
    set('svc-ph', svcs.length?svcs.length+' active':'—');
    document.getElementById('svc-grid').innerHTML='<div class="pd-svc">'+svcs.map(s=>{
      const cls=(['NETWORK','WITNESS'].includes(s))?'svc-core':(['BLOOM','COMPACT_FILTERS','P2P_V2'].includes(s))?'svc-cap':'svc-ltd';
      return `<span class="${cls}">${esc(s)}</span>`;
    }).join('')+'</div>';
  },

  _renderLocalAddrs(localAddresses){
    this._lastLocalAddrs=localAddresses||[];
    const el=document.getElementById('ni-localaddrs');
    if(!el) return;
    if(!this._lastLocalAddrs.length){
      el.innerHTML='<span style="font-size:9px;color:var(--t4);padding:2px 0;display:block">not reachable / no external address</span>';
      return;
    }
    const MASK='•••••••••••••••••••';
    el.innerHTML=this._lastLocalAddrs.map(a=>{
      const addr=esc(a.address||'');
      const score=a.score!=null?a.score:'';
      const type=addr.endsWith('.onion')?'onion':(addr.startsWith('[')||(addr.includes(':')&&!addr.includes('.')))?'ipv6':'ipv4';
      const typeColor=type==='onion'?'var(--orange)':type==='ipv6'?'var(--pos)':'var(--t4)';
      const display=this._localAddrsRevealed?addr:MASK;
      const cls=this._localAddrsRevealed?'la-addr':'la-addr masked';
      return `<div class="la-row">
        <span class="${cls}">${display}</span>
        <span class="la-type" style="color:${typeColor}">${type}</span>
        ${score!==''?`<span class="la-score">s:${score}</span>`:''}
      </div>`;
    }).join('');
  },

  toggleLocalAddrs(){
    this._localAddrsRevealed=!this._localAddrsRevealed;
    const btn=document.getElementById('la-reveal-btn');
    if(btn) btn.textContent=this._localAddrsRevealed?'hide':'reveal';
    this._renderLocalAddrs(this._lastLocalAddrs);
  },

  _updateSync(progress){
    const now=Date.now();
    this._syncHistory.push({progress,ts:now});
    if(this._syncHistory.length>20) this._syncHistory.shift();

    const fill=document.getElementById('sync-fill');
    const pct=progress*100;
    if(fill) fill.style.width=pct.toFixed(2)+'%';

    if(this._syncHistory.length<3){ set('sync-eta',pct.toFixed(3)+'%'); return; }

    const newest=this._syncHistory[this._syncHistory.length-1];
    const oldest=this._syncHistory[0];
    const dp=newest.progress-oldest.progress;
    const dt=newest.ts-oldest.ts;
    if(dp<=0||dt<=0){ set('sync-eta',pct.toFixed(3)+'%'); return; }

    const sLeft=(1-progress)/(dp/dt)/1000;
    let eta;
    if(sLeft<60)        eta=Math.round(sLeft)+'s';
    else if(sLeft<3600) eta=Math.round(sLeft/60)+'m '+Math.round(sLeft%60)+'s';
    else if(sLeft<86400)eta=Math.round(sLeft/3600)+'h '+Math.round((sLeft%3600)/60)+'m';
    else                eta=Math.round(sLeft/86400)+'d '+Math.round((sLeft%86400)/3600)+'h';
    set('sync-eta', pct.toFixed(3)+'%  · est. '+eta);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN MODULE — fee estimates panel (chain panel bandwidth is in network module)
// ═══════════════════════════════════════════════════════════════════════════════
const chainPanel = {
  render(d){
    const blocks=d.blocks||[];
    const now=Date.now()/1000;
    set('ch-tip-age', blocks.length&&blocks[0].time?utils.fmtAgeAgo(now-blocks[0].time):'—');
    this._renderFees(d.fees||{});
  },

  _renderFees(fees){
    // 'time' now shows the actual conf_target from the server — if targets
    // change in server.js the labels here update automatically with no drift.
    const t=n=>n!=null?'target '+n+' blk':'';
    const feeList=[
      fees.fast!=null?{label:'next block',rate:fees.fast,time:t(fees.fast_target)}:null,
      fees.med !=null?{label:'6 blocks',  rate:fees.med, time:t(fees.med_target)} :null,
      fees.slow!=null?{label:'1 day',     rate:fees.slow,time:t(fees.slow_target)}:null,
      fees.eco !=null?{label:'economy',   rate:fees.eco, time:t(fees.eco_target)} :null,
    ].filter(Boolean);

    const el=document.getElementById('fee-rows');
    if(!el) return;
    if(!feeList.length){
      el.innerHTML='<div style="font-size:8.5px;color:var(--t4);padding:4px 0">no fee data — estimator warming up</div>';
      return;
    }
    const maxRate=Math.max(...feeList.map(e=>e.rate));
    el.innerHTML=feeList.map((e,i)=>{
      const valStr=e.rate>=1?f(e.rate,0):f(e.rate,2);
      const pct=(e.rate/maxRate*100).toFixed(1);
      return `<div class="fee-bar-row" data-copy="${valStr}">
        <div class="fee-bar-accent"></div>
        <div class="fee-bar-body">
          <span class="fee-bar-lbl">${e.label}</span>
          <span class="fee-bar-time">${e.time}</span>
        </div>
        <div class="fee-bar-right">
          <span class="fee-bar-val">${valStr}</span>
          <span class="fee-bar-unit">sat/vB</span>
        </div>
        <div class="fee-bar-fill"><div class="fee-bar-fill-inner" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// PEERS MODULE — peer table, peer detail, ban list, RPC actions
// ═══════════════════════════════════════════════════════════════════════════════
const peersPanel = {
  _cache: [],
  _selectedId: null,

  async rpc(method, params){
    try{
      const res=await fetch('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,params})});
      const j=await res.json();
      if(j.error) throw new Error(j.error);
      return j.result;
    }catch(e){
      set('sb-err', method+': '+e.message);
      setTimeout(()=>set('sb-err',''),4000);
      throw e;
    }
  },

  render(d){
    const peers=d.peers||[];
    const ni=d.networkInfo||{};
    const now=Date.now()/1000;
    this._cache=peers;

    const peersIn=peers.filter(p=>p.inbound);
    const peersOut=peers.filter(p=>!p.inbound);
    const connIn=ni.connections_in!=null?ni.connections_in:peersIn.length;
    const connOut=ni.connections_out!=null?ni.connections_out:peersOut.length;
    set('peer-in-ph', '↓ '+connIn+' in');
    set('peer-out-ph','↑ '+connOut+' out');

    const bestPeerBlock=peers.reduce((best,p)=>Math.max(best,p.last_block||0),0);

    // Compute max bytes for proportional bandwidth bars across all peers
    const maxSent=peers.reduce((m,p)=>Math.max(m,p.bytessent||0),1);
    const maxRecv=peers.reduce((m,p)=>Math.max(m,p.bytesrecv||0),1);

    document.getElementById('peer-table-body').innerHTML=peers.map(p=>{
      const net=utils.peerNet(p.addr||'',p.network||'');
      const netColor=net==='onion'?'var(--orange)':'var(--t3)';
      const pc=p.pingtime>0?(p.pingtime<0.06?'grn':p.pingtime<0.18?'dim':'neg'):'dim';
      const ping=p.pingtime>0?Math.round(p.pingtime*1000)+'ms':'—';
      const ver=esc((p.subver||'').replace(/^\/|\/$/g,''));
      const addr=esc(p.addr||'');
      const isBlockRelay=(p.connection_type||'').includes('block-relay');
      const connAge=p.conntime?(now-p.conntime):0;
      const peerBlockAge=p.last_block>0?(now-p.last_block):Infinity;
      const peerTxAge=p.last_transaction>0?(now-p.last_transaction):Infinity;
      const networkHasBlocks=bestPeerBlock>0&&(now-bestPeerBlock)<1200;
      const blockStale=connAge>300&&peerBlockAge>1200&&networkHasBlocks;
      const txStale=!isBlockRelay&&p.relaytxes!==false&&connAge>300&&peerTxAge>1200&&networkHasBlocks;
      const isStale=blockStale&&(isBlockRelay||txStale);

      // Ping cell: coloured dot + value
      const pingCell=p.pingtime>0
        ?`<span class="ping-cell"><span class="ping-dot ${pc}"></span><span class="ping-val td-${pc}">${ping}</span></span>`
        :`<span class="ping-cell"><span class="ping-dot dim"></span><span class="ping-val dim">—</span></span>`;

      // Bandwidth cells: value + proportional mini-bar
      const sentPct=((p.bytessent||0)/maxSent*100).toFixed(1);
      const recvPct=((p.bytesrecv||0)/maxRecv*100).toFixed(1);
      const bwSentCell=`<div class="peer-bw-wrap"><span class="peer-bw-val">${utils.fmtBytes(p.bytessent||0)}</span><div class="peer-bw-bar"><div class="peer-bw-fill" style="width:${sentPct}%;background:var(--pos)"></div></div></div>`;
      const bwRecvCell=`<div class="peer-bw-wrap"><span class="peer-bw-val">${utils.fmtBytes(p.bytesrecv||0)}</span><div class="peer-bw-bar"><div class="peer-bw-fill" style="width:${recvPct}%;background:var(--orange)"></div></div></div>`;

      return `<tr data-pid="${p.id}" class="${p.id===this._selectedId?'peer-sel':''}${isStale?' peer-stale':''}">
        <td class="td-dir"><span style="color:${p.inbound?'var(--grn)':'var(--t3)'}">${p.inbound?'↓':'↑'}</span></td>
        <td class="td-hash td-peer-addr copyable" data-copy="${addr}"><span class="peer-addr-main">${addr||'—'}</span><span class="peer-addr-bars"><span class="peer-addr-bar-sent"><span class="peer-addr-bar-fill" style="width:${sentPct}%;background:var(--pos)"></span></span><span class="peer-addr-bar-recv"><span class="peer-addr-bar-fill" style="width:${recvPct}%;background:var(--orange)"></span></span></span></td>
        <td class="td-net" style="color:${netColor}">${esc(net)}</td>
        <td class="td-ver td-dim">${ver}</td>
        <td class="td-dim td-r">${fb(p.synced_blocks||0)}</td>
        <td class="td-r" style="white-space:nowrap">${pingCell}</td>
        <td class="td-r" style="padding-top:2px;padding-bottom:2px">${bwSentCell}</td>
        <td class="td-r" style="padding-top:2px;padding-bottom:2px">${bwRecvCell}</td>
      </tr>`;
    }).join('');

    // Re-render detail for selected peer with fresh data
    if(this._selectedId!=null){
      const p=this._cache.find(x=>x.id===this._selectedId);
      if(p) this.renderDetail(p);
    }
  },

  _activeTab: 'conn',

  renderDetail(p){
    const body=document.getElementById('peer-detail-body');
    const tabsEl=document.getElementById('pd-tabs');
    if(!p){
      if(body) body.innerHTML='<div class="pd-empty">click a peer to inspect</div>';
      if(tabsEl) tabsEl.style.display='none';
      set('pd-ph','—');
      return;
    }
    if(tabsEl) tabsEl.style.display='';

    const svcs=utils.decodeServices(p.services);
    const net=utils.peerNet(p.addr||'',p.network||'');
    const now=Date.now()/1000;
    const verClean=esc((p.subver||'').replace(/^\/|\/$/g,''));
    const netColor=net==='onion'?'var(--orange)':net==='i2p'?'var(--pos)':'var(--t2)';
    const addrDisplay=(p.addr||'').replace(/:\d+$/,'').replace(/^\[(.+)\]$/,'$1');
    set('pd-ph', addrDisplay||'—');

    // Connection type with feeler/addr-fetch distinction
    const ct=p.connection_type||'';
    const CT_COLOR={
      'outbound-full-relay':'var(--t2)',
      'block-relay-only':'var(--pos)',
      'inbound':'var(--grn)',
      'feeler':'var(--orange)',
      'addr-fetch':'var(--orange)',
      'manual':'var(--t1)',
    };
    const ctColor=CT_COLOR[ct]||'var(--t3)';
    const ctLabel=ct||'—';

    // Permissions decode (bitmask string or array)
    const permsArr=Array.isArray(p.permissions)?p.permissions:
      (p.permissions?String(p.permissions).split(',').map(s=>s.trim()).filter(Boolean):[]);
    const permsStr=permsArr.length?permsArr.join(', '):'none';

    // ASN — only populated by Bitcoin Core when started with -asmap=<file>.
    // Without an asmap file, mapped_as is absent from getpeerinfo entirely.
    const asnStr=p.mapped_as!=null?('AS'+p.mapped_as):null;

    // last_send / last_recv
    const lastSendStr=p.lastsend>0?utils.fmtAgeAgo(now-p.lastsend):'—';
    const lastRecvStr=p.lastrecv>0?utils.fmtAgeAgo(now-p.lastrecv):'—';

    // Whitelisted (pre-28 field)
    const whitelistedStr=p.whitelisted!=null?(p.whitelisted?'yes':'no'):permsArr.length?'(see perms)':'—';

    const tabs={
      conn:`
        <div class="kv"><span class="k">address</span><span class="v mono v-copyable" style="word-break:break-all;white-space:normal;line-height:1.5;text-align:right">${esc(p.addr||'—')}<span data-copy="${esc(p.addr||'')}" class="copy-icon">⎘</span></span></div>
        <div class="kv"><span class="k">net · dir</span><span class="v"><span style="color:${netColor}">${esc(net)}</span><span class="dim"> · ${p.inbound?'← in':'→ out'}</span></span></div>
        <div class="kv"><span class="k">type</span><span class="v" style="color:${ctColor}">${esc(ctLabel)}</span></div>
        <div class="kv"><span class="k">transport</span><span class="v dim">${esc(p.transport_protocol_type||'—')}</span></div>
        <div class="kv"><span class="k">session id</span><span class="v mono" style="text-align:right;word-break:break-all;white-space:normal;line-height:1.5">${p.session_id?esc(p.session_id.slice(0,16))+'…':'—'}</span></div>
        <div class="kv"><span class="k">relay txs</span><span class="v ${p.relaytxes===false?'neg':''}">${p.relaytxes===false?'no':'yes'}</span></div>
        <div class="kv"><span class="k">ASN</span><span class="v dim">${asnStr!=null?esc(asnStr):'—'}</span></div>
        ${p.addr_local?`<div class="kv"><span class="k">addr local</span><span class="v mono" style="text-align:right;word-break:break-all;white-space:normal;line-height:1.5">${esc(p.addr_local)}</span></div>`:''}
        <div class="sec">version</div>
        <div class="kv"><span class="k">protocol</span><span class="v dim">${esc(String(p.version||'—'))}</span></div>
        <div class="kv"><span class="k">user agent</span><span class="v" style="text-align:right"><span class="pd-ua-badge" style="display:inline;word-break:break-all;white-space:normal;line-height:1.8">${verClean||'—'}</span></span></div>
        <div class="sec">permissions</div>
        <div class="kv"><span class="k">whitelisted</span><span class="v dim">${esc(whitelistedStr)}</span></div>
        <div class="kv"><span class="k">flags</span><span class="v dim" style="word-break:break-all;white-space:normal;text-align:right;line-height:1.5">${esc(permsStr)}</span></div>
        <div class="sec">services</div>
        <div class="pd-svc">${svcs.map(s=>{
          const cls=(['NETWORK','WITNESS'].includes(s))?'svc-core':(['BLOOM','COMPACT_FILTERS','P2P_V2'].includes(s))?'svc-cap':'svc-ltd';
          return `<span class="${cls}">${esc(s)}</span>`;
        }).join('')}</div>
        <div class="sec">actions</div>
        <div class="peer-actions">
          <button class="pa-btn" data-pa="disconnect">disconnect</button>
          <button class="pa-btn pa-ban" data-pa="ban1h">ban 1h</button>
          <button class="pa-btn pa-ban" data-pa="ban24h">ban 24h</button>
          <button class="pa-btn pa-ban" data-pa="ban7d">ban 7d</button>
          <button class="pa-btn pa-ban" data-pa="ban30d">ban 30d</button>
          <button class="pa-btn pa-ban" data-pa="banperm">ban ∞</button>
        </div>`,

      sync:`
        <div class="kv"><span class="k">blocks</span><span class="v">${fb(p.synced_blocks||0)}</span></div>
        <div class="kv"><span class="k">headers</span><span class="v dim">${fb(p.synced_headers||0)}</span></div>
        <div class="kv"><span class="k">start height</span><span class="v dim">${fb(p.startingheight||0)}</span></div>
        <div class="kv"><span class="k">hdr–blk gap</span><span class="v ${(p.synced_headers-p.synced_blocks)>10?'o':'dim'}">${fb((p.synced_headers||0)-(p.synced_blocks||0))}</span></div>
        <div class="sec">compact blocks (BIP152)</div>
        <div class="kv"><span class="k">HB to peer</span><span class="v ${p.bip152_hb_to?'grn':'dim'}">${p.bip152_hb_to!=null?(p.bip152_hb_to?'yes — high-bandwidth':'no — low-bandwidth'):'—'}</span></div>
        <div class="kv"><span class="k">HB from peer</span><span class="v ${p.bip152_hb_from?'grn':'dim'}">${p.bip152_hb_from!=null?(p.bip152_hb_from?'yes — high-bandwidth':'no — low-bandwidth'):'—'}</span></div>
        <div class="sec">timing</div>
        <div class="kv"><span class="k">connected</span><span class="v dim">${p.conntime?utils.fmtAge(now-p.conntime):'—'}</span></div>
        <div class="kv"><span class="k">last send</span><span class="v dim">${lastSendStr}</span></div>
        <div class="kv"><span class="k">last recv</span><span class="v dim">${lastRecvStr}</span></div>
        <div class="kv"><span class="k">last block</span><span class="v dim">${p.last_block>0?utils.fmtAgeAgo(now-p.last_block):'—'}</span></div>
        <div class="kv"><span class="k">last tx</span><span class="v dim">${p.last_transaction>0?utils.fmtAgeAgo(now-p.last_transaction):'—'}</span></div>
        <div class="kv"><span class="k">time offset</span><span class="v ${Math.abs(p.timeoffset||0)>70?'neg':'dim'}">${p.timeoffset!=null?(p.timeoffset>0?'+':'')+p.timeoffset+'s':'—'}</span></div>
        <div class="sec">latency</div>
        <div class="kv"><span class="k">ping</span><span class="v ${p.pingtime>0?(p.pingtime<0.06?'grn':p.pingtime<0.18?'dim':'neg'):'dim'}">${p.pingtime>0?Math.round(p.pingtime*1000)+'ms':'—'}</span></div>
        <div class="kv"><span class="k">min ping</span><span class="v dim">${p.minping>0?Math.round(p.minping*1000)+'ms':'—'}</span></div>
        ${p.pingwait!=null?`<div class="kv"><span class="k">ping wait</span><span class="v neg">${Math.round(p.pingwait*1000)}ms (in flight)</span></div>`:''}`,

      bw:`
        <div class="kv"><span class="k">↑ sent</span><span class="v dim">${utils.fmtBytes(p.bytessent||0)}</span></div>
        <div class="kv"><span class="k">↓ recv</span><span class="v dim">${utils.fmtBytes(p.bytesrecv||0)}</span></div>
        <div class="kv"><span class="k">fee filter</span><span class="v dim">${(()=>{const ff=p.minfeefilter??p.fee_filter;return ff!=null?f(ff*1e5,2)+' sat/vB':'—';})()}</span></div>
        ${(()=>{
          const sm=p.bytessent_per_msg||{};
          const rm=p.bytesrecv_per_msg||{};
          const keys=[...new Set([...Object.keys(sm),...Object.keys(rm)])].sort();
          if(!keys.length) return '';
          return '<div class="sec">per-message (bytes)</div>'+keys.map(k=>{
            const s=sm[k]||0, r=rm[k]||0;
            return `<div class="kv"><span class="k">${esc(k)}</span><span class="v dim">↑${utils.fmtBytes(s)} ↓${utils.fmtBytes(r)}</span></div>`;
          }).join('');
        })()}`,

      gossip:`
        <div class="kv"><span class="k">addr processed</span><span class="v dim">${p.addr_processed!=null?fb(p.addr_processed):'—'}</span></div>
        <div class="kv"><span class="k">addr rate-lim</span><span class="v ${p.addr_rate_limited>0?'neg':'dim'}">${p.addr_rate_limited!=null?fb(p.addr_rate_limited):'—'}</span></div>`,
    };

    body.innerHTML=tabs[this._activeTab]||tabs.conn;

    // Wire tab buttons
    document.querySelectorAll('.pd-tab').forEach(btn=>{
      btn.classList.toggle('active', btn.dataset.tab===this._activeTab);
      btn.onclick=()=>{
        this._activeTab=btn.dataset.tab;
        document.querySelectorAll('.pd-tab').forEach(b=>b.classList.toggle('active',b===btn));
        body.innerHTML=tabs[this._activeTab]||tabs.conn;
        this._wireActions(p, body);
      };
    });

    this._wireActions(p, body);
  },

  _wireActions(p, body){
    body.querySelectorAll('.pa-btn[data-pa]').forEach(btn=>{
      btn.addEventListener('click', async e=>{
        e.stopPropagation();
        btn.classList.add('pa-working');
        try{
          const action=btn.dataset.pa;
          if(action==='disconnect'){
            await this.rpc('disconnectnode',[p.addr||'']);
          } else {
            const banAddr=(p.addr||'').replace(/:(\d+)$/,'').replace(/^\[(.+)\]$/,'$1');
            if(action==='banperm'){
              await this.rpc('setban',[banAddr,'add',253370764800,true]);
            } else {
              const dur={ban1h:3600,ban24h:86400,ban7d:604800,ban30d:2592000}[action];
              await this.rpc('setban',[banAddr,'add',dur,false]);
            }
          }
          this._selectedId=null;
          this.renderDetail(null);
          banList.refresh();
          setTimeout(()=>poller.fetchNow(),600);
        }catch(_){
          btn.classList.remove('pa-working');
        }
      });
    });
  },

  selectById(pid){
    this._activeTab='conn';
    this._selectedId=pid;
    document.getElementById('peer-table-body')?.querySelectorAll('tr').forEach(r=>
      r.classList.toggle('peer-sel',parseInt(r.dataset.pid,10)===pid)
    );
    const p=this._cache.find(x=>x.id===pid);
    if(p) this.renderDetail(p);
  },

  exportTSV(){
    const now=Date.now()/1000;
    const cols=[
      'id','addr','network','direction','connection_type','relaytxes',
      'version','subver','synced_blocks','synced_headers','startingheight',
      'pingtime_ms','minping_ms','conntime_age_s','lastrecv_ago_s',
      'last_block_ago_s','last_transaction_ago_s',
      'bytessent','bytesrecv','services','minfeefilter',
      'addr_processed','addr_rate_limited','transport_protocol_type',
    ];
    const row=p=>[
      p.id,
      p.addr||'',
      utils.peerNet(p.addr||'',p.network||''),
      p.inbound?'inbound':'outbound',
      p.connection_type||'',
      p.relaytxes===false?'false':'true',
      p.version||'',
      (p.subver||'').replace(/^\/|\/$/g,''),
      p.synced_blocks??'',
      p.synced_headers??'',
      p.startingheight??'',
      p.pingtime>0?Math.round(p.pingtime*1000):'',
      p.minping>0?Math.round(p.minping*1000):'',
      p.conntime?Math.round(now-p.conntime):'',
      p.lastrecv?Math.round(now-p.lastrecv):'',
      p.last_block>0?Math.round(now-p.last_block):'',
      p.last_transaction>0?Math.round(now-p.last_transaction):'',
      p.bytessent??0,
      p.bytesrecv??0,
      p.services||'',
      p.minfeefilter??p.fee_filter??'',
      p.addr_processed??'',
      p.addr_rate_limited??'',
      p.transport_protocol_type||'',
    ].map(v=>String(v).replace(/\t/g,' ')).join('\t');

    const tsv=[cols.join('\t'), ...this._cache.map(row)].join('\n');
    const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([tsv],{type:'text/tab-separated-values'}));
    a.download=`peers-${ts}.tsv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// BAN LIST MODULE
// ═══════════════════════════════════════════════════════════════════════════════
const banList = {
  async refresh(){
    const rowsEl=document.getElementById('ban-rows');
    const phEl=document.getElementById('ban-ph');
    if(!rowsEl) return;
    let bans=[];
    try{ bans=await peersPanel.rpc('listbanned',[]); }catch(_){ return; }
    if(!bans||!bans.length){
      if(phEl) phEl.textContent='—';
      rowsEl.innerHTML='<div class="ban-empty">no bans</div>';
      return;
    }
    if(phEl) phEl.textContent=bans.length+(bans.length===1?' address':' addresses');
    rowsEl.innerHTML=bans.map(b=>
      '<div class="ban-row">'
      +'<span class="ban-row-addr">'+esc(b.address||'')+'</span>'
      +'<span class="ban-row-exp">'+utils.fmtBanLeft(b)+'</span>'
      +'<button class="pa-btn pa-unban" data-unban="'+esc(b.address||'')+'">unban</button>'
      +'</div>'
    ).join('');
    rowsEl.querySelectorAll('.pa-btn[data-unban]').forEach(btn=>{
      btn.addEventListener('click', async e=>{
        e.stopPropagation();
        btn.classList.add('pa-working');
        try{
          await peersPanel.rpc('setban',[btn.dataset.unban,'remove']);
          await this.refresh();
          setTimeout(()=>poller.fetchNow(),400);
        }catch(_){
          btn.classList.remove('pa-working');
        }
      });
    });
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKS MODULE — blocks table, block detail, block activity table
// ═══════════════════════════════════════════════════════════════════════════════
const blocksPanel = {
  _cache: [],
  _selectedHeight: null,
  _lastDeploymentInfo: {},

  render(d){
    const blocks=d.blocks||[];
    const now=Date.now()/1000;
    this._cache=blocks;
    this._lastDeploymentInfo=d.deploymentInfo||{};

    set('blk-ph', blocks.length?'tip #'+fb(blocks[0].height):'—');

    document.getElementById('blk-body').innerHTML=blocks.map((b,i)=>{
        return `
      <tr class="${i===0?'new':''} ${b.height===this._selectedHeight?'peer-sel':''}" data-bheight="${b.height}">
        <td class="td-num"><a class="ext-link" href="${utils.mspaceUrl(b.hash,nodePanel.currentChain)}" target="_blank" rel="noopener noreferrer">${fb(b.height)}</a></td>
        <td class="td-hash" style="white-space:nowrap;cursor:pointer" data-copy="${esc(b.hash||'')}"><em>${(b.hash||'').slice(0,4)}</em>${(b.hash||'').slice(4,8)}…${(b.hash||'').slice(-4)}</td>
        <td class="td-dim">${fb(b.txs)}</td>
        <td class="td-inout">${b.ins||b.outs?fb(b.ins)+'<span style="color:var(--t4)">·</span>'+fb(b.outs):'—'}</td>
        <td style="vertical-align:middle">${(()=>{const pct=b.weight?b.weight/4000000*100:0;const clr=pct>=85?'var(--grn)':pct>=60?'var(--pos)':pct>=30?'var(--orange)':'var(--neg)';return pct?`<div style="width:100%;height:2px;background:var(--raised);border-radius:2px;overflow:hidden"><div style="width:${Math.min(pct,100).toFixed(1)}%;height:100%;background:${clr};border-radius:2px;transition:width .9s cubic-bezier(.4,0,.2,1)"></div></div>`:'<div style="width:100%;height:2px;background:var(--raised);border-radius:2px"></div>';})()}</td>
        <td class="td-dim">${b.time?utils.fmtAge(now-b.time):'—'}</td>
      </tr>`}).join('');

    if(this._selectedHeight==null&&blocks.length) this.renderDetail(blocks[0]);
    else if(this._selectedHeight!=null){
      const sel=blocks.find(x=>x.height===this._selectedHeight)||blocks[0];
      if(sel) this.renderDetail(sel);
    }
  },

  renderDetail(b){
    const el=document.getElementById('block-detail-body');
    const ph=document.getElementById('bd-ph');
    if(!b){ if(el) el.innerHTML='<div class="pd-empty">—</div>'; if(ph) ph.textContent='latest'; return; }
    if(ph) ph.textContent='#'+fb(b.height);
    const now=Date.now()/1000;

    const avgfeeStr=(()=>{
      if(b.avgfeerate>=1) return f(b.avgfeerate,0)+' sat/vB';
      if(b.totalfee>0&&b.size>0) return f(b.totalfee/b.size,2)+' sat/vB';
      return '—';
    })();
    const avgFeeCls=b.avgfeerate>20?'o':b.avgfeerate>5?'o2':'grn';
    const fillPct=b.weight?b.weight/4000000*100:0;
    const fillCls=fillPct>=85?'grn':fillPct>=60?'o2':fillPct>=30?'o':'neg';

    let era='—';
    if(b.subsidy!=null){
      if(b.subsidy>=5000000000)      era='1';
      else if(b.subsidy>=2500000000) era='2';
      else if(b.subsidy>=1250000000) era='3';
      else if(b.subsidy>=625000000)  era='4';
      else if(b.subsidy>=312500000)  era='5';
      else if(b.subsidy>0)           era='6+';
      else                            era='none';
    }

    const totalReward=(b.totalfee||0)+(b.subsidy||0);
    const feeRatioPct=totalReward>0?(b.totalfee||0)/totalReward*100:0;
    const feeRatioStr=totalReward>0?f(feeRatioPct,2)+'%':'—';
    const feeRatioCls=feeRatioPct>20?'o':feeRatioPct>5?'o2':'dim';

    // BIP9 signalling
    const deployments=(this._lastDeploymentInfo&&this._lastDeploymentInfo.deployments)||{};
    const sigBits=[];
    Object.entries(deployments).forEach(([name,fork])=>{
      if(fork.bip9&&fork.bip9.bit!=null){
        if((b.version>>>0)&(1<<fork.bip9.bit)) sigBits.push(name);
      }
    });
    const bip9Compliant=((b.version>>>0)>>>29)===0b001;
    const sigStr=sigBits.length?sigBits.map(esc).join(', '):(bip9Compliant?'none':'n/a');
    const sigCls=sigBits.length?'o2':'dim';

    // Fee percentiles — p10/p25/p50/p75/p90 sat/vB
    const pctStr=(()=>{
      const p=b.feePercentiles;
      if(!p||p.length<5) return null;
      const fmt=v=>esc(v>=1?String(Math.round(v)):v.toFixed(1));
      return `${fmt(p[0])} · ${fmt(p[1])} · <span class="o2">${fmt(p[2])}</span> · ${fmt(p[3])} · ${fmt(p[4])}`;
    })();

    if(el) el.innerHTML=`
      <div class="kv"><span class="k">height</span><span class="v">${fb(b.height)}</span></div>
      <div class="kv"><span class="k">hash</span><span class="v mono v-copyable"><a class="ext-link" href="${utils.mspaceUrl(b.hash,nodePanel.currentChain)}" target="_blank" rel="noopener noreferrer"><em>${(b.hash||'').slice(0,6)}</em>…${(b.hash||'').slice(-6)}</a><span data-copy="${esc(b.hash||'')}" class="copy-icon">⎘</span></span></div>
      <div class="kv"><span class="k">age · txs</span><span class="v"><span class="dim">${b.time?utils.fmtAgeAgo(now-b.time):'—'}</span><span class="v-pair-sep"> · </span><span class="o2">${fb(b.txs)}</span></span></div>
      <div class="kv"><span class="k">in · out</span><span class="v dim">${b.ins?fb(b.ins):'-'}<span class="v-pair-sep"> · </span>${b.outs?fb(b.outs):'-'}</span></div>
      <div class="kv"><span class="k">size · fill</span><span class="v dim">${utils.fmtBytes(b.size)}<span class="v-pair-sep"> · </span><span class="${fillCls}">${fillPct?f(fillPct,0)+'%':'—'}</span></span></div>
      <div class="kv"><span class="k">avg · total fee</span><span class="v"><span class="${avgFeeCls}">${avgfeeStr}</span><span class="v-pair-sep"> · </span><span class="o2">${b.totalfee?utils.fmtSats(b.totalfee):'—'}</span></span></div>
      ${pctStr?`<div class="kv"><span class="k">fee pctiles</span><span class="v dim" style="font-size:9px">${pctStr}</span></div>`:''}
      <div class="kv"><span class="k">subsidy · era</span><span class="v"><span class="o2">${b.subsidy!=null?f(b.subsidy/1e8,3):'—'}</span><span class="v-pair-sep"> · </span><span class="dim">${era}</span></span></div>
      <div class="kv"><span class="k">fee share</span><span class="v ${feeRatioCls}">${feeRatioStr}</span></div>
      <div class="kv"><span class="k">signalling</span><span class="v ${sigCls}" style="word-break:break-all;white-space:normal;text-align:right;line-height:1.5">${sigStr}</span></div>
      <div class="kv"><span class="k">version · bits</span><span class="v mono" style="font-size:8.5px">0x${(b.version>>>0).toString(16).padStart(8,'0')}<span class="v-pair-sep"> · </span>${b.bits?'0x'+esc(b.bits):'—'}</span></div>
      <div class="kv"><span class="k">nonce</span><span class="v mono" style="font-size:9px;color:var(--t4)">${b.nonce!=null?fb(b.nonce):'—'}</span></div>
      <div class="kv"><span class="k">median time</span><span class="v dim">${b.mediantime?utils.fmtTimestamp(b.mediantime):'—'}</span></div>`;
  },

  selectByHeight(height){
    this._selectedHeight=height;
    document.getElementById('blk-body')?.querySelectorAll('tr').forEach(r=>
      r.classList.toggle('peer-sel',parseInt(r.dataset.bheight,10)===height)
    );
    const b=this._cache.find(x=>x.height===height);
    if(b) this.renderDetail(b);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CHARTS MODULE — fee heatmap, fee/subsidy sparkline, block timing bars
// Each chart is a self-contained object: draw(blocks) is the public API,
// _render() does the actual canvas/DOM work, ResizeObserver calls _measure().
// ═══════════════════════════════════════════════════════════════════════════════
const charts = {

  feeHeatmap: {
    _blocks: [],
    _BUCKETS: [
      {label:'1000+',min:1000,max:Infinity},
      {label:'500',  min:500, max:1000},
      {label:'200',  min:200, max:500},
      {label:'100',  min:100, max:200},
      {label:'50',   min:50,  max:100},
      {label:'20',   min:20,  max:50},
      {label:'10',   min:10,  max:20},
      {label:'5',    min:5,   max:10},
      {label:'2',    min:2,   max:5},
      {label:'1',    min:1,   max:2},
      {label:'<1',   min:0,   max:1},
    ],
    draw(blocks){ if(blocks?.length) this._blocks=blocks; this._render(this._blocks); },
    _render(blocks){
      const wrap=document.getElementById('fee-heatmap-wrap');
      if(!wrap||!blocks||!blocks.length) return;
      // Read accent colour once per render — avoids a style recalc on every cell
      const rgb=(getComputedStyle(document.documentElement).getPropertyValue('--orange-rgb')||'240,112,32').trim();
      const bChron=[...blocks].reverse();
      const matrix=this._BUCKETS.map((bucket,bi)=>bChron.map(b=>{
        const p=b.feePercentiles;
        if(p&&p.length===5){
          const [p10,p25,p50,p75,p90]=p;
          if(p50>=bucket.min&&p50<bucket.max) return 1.0;
          if(p75>bucket.min&&p25<bucket.max)  return 0.55;
          if(p90>bucket.min&&p10<bucket.max)  return 0.18;
          return 0;
        }
        const rate=b.avgfeerate||0;
        if(!rate) return 0;
        if(rate>=bucket.min&&rate<bucket.max) return 1.0;
        const above=this._BUCKETS[bi-1],below=this._BUCKETS[bi+1];
        if(above&&rate>=above.min&&rate<above.max) return 0.22;
        if(below&&rate>=below.min&&rate<below.max)  return 0.22;
        return 0;
      }));
      const colLabelHtml=`<div class="fh-col-labels">${bChron.map(b=>`<span class="fh-col-label">…${String(b.height).slice(-3)}</span>`).join('')}</div>`;
      const rowHtml=this._BUCKETS.map((bucket,ri)=>{
        const cells=matrix[ri].map(v=>{
          const alpha=v===0?0.04:v>=0.9?0.82:v>=0.5?0.46:0.16;
          return `<div class="fh-cell" style="background:rgba(${rgb},${alpha})"></div>`;
        }).join('');
        return `<div class="fh-row"><span class="fh-label">${bucket.label}</span><div class="fh-cells">${cells}</div></div>`;
      }).join('');
      wrap.innerHTML=colLabelHtml+rowHtml;
      const hasPercentiles=blocks.some(b=>b.feePercentiles);
      const ph=document.getElementById('fh-ph');
      if(ph) ph.textContent='last '+blocks.length+' blocks · sat/vB'+(hasPercentiles?' · p10–p90':' · avg');
    },
  },

  feeSubsidy: {
    _blocks: [],
    _panel: null,
    draw(blocks){ if(blocks?.length) this._blocks=blocks; this._measure(); },
    _measure(){
      const panel=this._panel||(this._panel=document.getElementById('p-col2-subsidy'));
      if(!panel) return;
      const r=panel.getBoundingClientRect();
      if(r.width<=10||r.height<=10) return;
      const ph=panel.querySelector('.ph');
      const leg=document.getElementById('fs-min')?.closest('div');
      const phH=ph?ph.getBoundingClientRect().height:24;
      const legH=leg?leg.getBoundingClientRect().height+3:18;
      this._render(this._blocks, r.width-20-8, Math.max(20,r.height-phH-14-legH-3));
    },
    _render(blocks, W, H){
      const canvas=document.getElementById('fs-canvas');
      if(!canvas||!blocks||blocks.length<2) return;
      const valid=[...blocks].filter(b=>(b.subsidy||0)+(b.totalfee||0)>0).reverse();
      if(valid.length<2){ set('fs-avg','no data'); return; }
      const dpr=window.devicePixelRatio||1;
      canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
      canvas.style.width=W+'px'; canvas.style.height=H+'px';
      const ctx=canvas.getContext('2d');
      if(!ctx) return;
      ctx.save(); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
      // Read accent colour once — avoids repeated style recalc
      const rgb=(getComputedStyle(document.documentElement).getPropertyValue('--orange-rgb')||'240,112,32').trim();
      const ratios=valid.map(b=>{const total=(b.totalfee||0)+(b.subsidy||0);return total>0?(b.totalfee||0)/total*100:0;});
      const maxR=Math.max(...ratios,5);
      const avgR=ratios.reduce((a,b)=>a+b,0)/ratios.length;
      const minR=Math.min(...ratios);
      const pad=2, xStep=(W-pad*2)/(ratios.length-1);
      const yOf=r=>H-pad-(r/maxR)*(H-pad*2);
      const grad=ctx.createLinearGradient(0,0,0,H);
      grad.addColorStop(0,`rgba(${rgb},0.28)`); grad.addColorStop(1,`rgba(${rgb},0.03)`);
      ctx.beginPath(); ctx.moveTo(pad,yOf(ratios[0]));
      ratios.forEach((r,i)=>{ if(i>0) ctx.lineTo(pad+i*xStep,yOf(r)); });
      ctx.lineTo(pad+(ratios.length-1)*xStep,H); ctx.lineTo(pad,H); ctx.closePath();
      ctx.fillStyle=grad; ctx.fill();
      ctx.beginPath(); ctx.moveTo(pad,yOf(ratios[0]));
      ratios.forEach((r,i)=>{ if(i>0) ctx.lineTo(pad+i*xStep,yOf(r)); });
      ctx.strokeStyle=`rgba(${rgb},0.75)`; ctx.lineWidth=1.5; ctx.lineJoin='round'; ctx.stroke();
      const lx=pad+(ratios.length-1)*xStep, ly=yOf(ratios[ratios.length-1]);
      ctx.beginPath(); ctx.arc(lx,ly,2.5,0,Math.PI*2); ctx.fillStyle=`rgba(${rgb},0.9)`; ctx.fill();
      if(maxR>=50){
        const refY=yOf(50);
        ctx.strokeStyle='rgba(90,90,90,0.55)'; ctx.lineWidth=1; ctx.setLineDash([3,3]);
        ctx.beginPath(); ctx.moveTo(0,refY); ctx.lineTo(W,refY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font='7px JetBrains Mono,monospace'; ctx.textAlign='right';
        ctx.fillStyle='rgba(90,90,90,0.6)'; ctx.fillText('50%',W-1,refY-2);
      }
      ctx.restore();
      set('fs-min',minR.toFixed(2)+'%'); set('fs-max',maxR.toFixed(2)+'%'); set('fs-avg','avg '+avgR.toFixed(2)+'%');
      const ph=document.getElementById('fs-ph');
      if(ph) ph.textContent='fees % of block reward · last '+valid.length;
    },
  },

  blockTiming: {
    _blocks: [],
    _panel: null,
    draw(blocks){ if(blocks?.length) this._blocks=blocks; this._measure(); },
    _measure(){
      const panel=this._panel||(this._panel=document.getElementById('p-col2-mid'));
      if(!panel) return;
      const r=panel.getBoundingClientRect();
      if(r.width<=10||r.height<=10) return;
      const ph=panel.querySelector('.ph');
      const legend=panel.querySelector('#bt-min')?.closest('div');
      const phH=ph?ph.getBoundingClientRect().height:24;
      const labelH=legend?legend.getBoundingClientRect().height+3:18;
      this._render(this._blocks, r.width-20-8, Math.max(20,r.height-phH-14-labelH-3));
    },
    _render(blocks, W, H){
      const canvas=document.getElementById('bt-canvas');
      if(!canvas||!blocks||blocks.length<2) return;
      const dpr=window.devicePixelRatio||1;
      canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr);
      canvas.style.width=W+'px'; canvas.style.height=H+'px';
      const ctx=canvas.getContext('2d');
      if(!ctx) return;
      ctx.save(); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
      // Read accent colour once — avoids repeated style recalc
      const accentRgb=(getComputedStyle(document.documentElement).getPropertyValue('--orange-rgb')||'240,112,32').trim();
      const gaps=[];
      for(let i=0;i<blocks.length-1;i++){
        const g=(blocks[i].time-blocks[i+1].time)/60;
        if(g>0&&g<180) gaps.push({g,current:false});
      }
      if(!gaps.length) return;
      gaps.reverse();
      // Add the current gap after reversing — time since tip to now, always rightmost
      if(blocks.length){
        const sinceNow=(Date.now()/1000-blocks[0].time)/60;
        if(sinceNow>0&&sinceNow<180) gaps.push({g:sinceNow,current:true});
      }
      const gVals=gaps.map(x=>x.g);
      const completedVals=gaps.filter(x=>!x.current).map(x=>x.g);
      const maxG=Math.max(...gVals,1);
      const minG=Math.min(...completedVals);
      const avgG=completedVals.reduce((a,b)=>a+b,0)/completedVals.length;
      const bw=Math.floor(W/gaps.length)-1;
      const pad=Math.floor((W-gaps.length*(bw+1))/2);
      const fontSize=Math.max(7,Math.min(10,Math.floor(bw*0.7)));
      ctx.font=`${fontSize}px JetBrains Mono, monospace`; ctx.textAlign='center';
      gaps.forEach(({g,current},i)=>{
        const barH=Math.max(2,Math.floor((g/maxG)*(H-4)));
        const x=pad+i*(bw+1), y=H-barH;
        if(current){
          // Current gap — hatched/dimmed to signal "in progress"
          ctx.fillStyle=`rgba(${accentRgb},0.25)`;
          ctx.fillRect(x,y,bw,barH);
          ctx.strokeStyle=`rgba(${accentRgb},0.5)`;
          ctx.lineWidth=1;
          ctx.setLineDash([2,2]);
          ctx.strokeRect(x+0.5,y+0.5,bw-1,barH-1);
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle=g<=avgG*1.4?'#3a6a48':g<=avgG*2?`rgba(${accentRgb},0.6)`:'#363636';
          ctx.fillRect(x,y,bw,barH);
        }
        const label=g>=10?Math.round(g)+'m':g.toFixed(1)+'m';
        const labelW=ctx.measureText(label).width;
        if(bw>=labelW+2){
          ctx.save();
          if(barH>=fontSize+6){
            ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillText(label,x+bw/2,y+fontSize+2);
          } else {
            ctx.fillStyle='rgba(104,104,104,0.85)'; ctx.fillText(label,x+bw/2,Math.max(fontSize+1,y-2));
          }
          ctx.restore();
        }
      });
      if(10<=maxG){
        const targetY=H-Math.floor((10/maxG)*(H-4))-1;
        ctx.strokeStyle='rgba(90,90,90,0.9)'; ctx.lineWidth=1; ctx.setLineDash([4,3]);
        ctx.beginPath(); ctx.moveTo(0,targetY); ctx.lineTo(W,targetY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font='7px JetBrains Mono, monospace'; ctx.textAlign='right';
        ctx.fillStyle='rgba(90,90,90,0.8)'; ctx.fillText('10m',W-1,targetY-2);
      }
      if(Math.abs(avgG-10)>0.5){
        const avgY=H-Math.floor((avgG/maxG)*(H-4))-1;
        ctx.strokeStyle=`rgba(${accentRgb},0.35)`; ctx.lineWidth=1; ctx.setLineDash([2,4]);
        ctx.beginPath(); ctx.moveTo(0,avgY); ctx.lineTo(W,avgY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font='7px JetBrains Mono, monospace'; ctx.textAlign='left';
        ctx.fillStyle=`rgba(${accentRgb},0.55)`; ctx.fillText('avg',2,avgY-2);
      }
      ctx.restore();
      set('bt-min',minG.toFixed(1)+'m'); set('bt-max',Math.max(...completedVals).toFixed(1)+'m');
      set('bt-avg','avg '+avgG.toFixed(1)+'m'); set('bt-ph','last '+completedVals.length);
    },
  },

  // Wire ResizeObservers once on init.
  // rAF-debounced: during column drag the observer fires ~30×/s; this collapses
  // back-to-back callbacks into a single canvas redraw per animation frame (~16ms).
  init(){
    if(typeof ResizeObserver==='undefined') return;
    const observe=(panel, chart)=>{
      if(!panel) return;
      let raf=null;
      new ResizeObserver(()=>{
        if(!chart._blocks.length) return;
        if(raf) cancelAnimationFrame(raf);
        raf=requestAnimationFrame(()=>{ raf=null; chart._measure(); });
      }).observe(panel);
    };
    observe(document.getElementById('p-col2-heatmap'), this.feeHeatmap);
    observe(document.getElementById('p-col2-subsidy'), this.feeSubsidy);
    observe(document.getElementById('p-col2-mid'),     this.blockTiming);

    const sparkPanel = document.getElementById('p-col2-top');
    if(sparkPanel && typeof ResizeObserver !== 'undefined'){
      let raf = null;
      new ResizeObserver(() => {
        if(raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { raf = null; network._drawSpark(); });
      }).observe(sparkPanel);
    }
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT MODULE — column/panel resize, drag-and-drop, hide/restore, persistence
// ═══════════════════════════════════════════════════════════════════════════════
const layout = {
  _main: document.getElementById('main'),
  _hiddenPanels: new Map(),
  _LS_KEY: 'bw_layout',

  // Design-default height ratios (fraction of available column height).
  // Used only when the user has never manually resized a panel.
  _DEFAULT_RATIO: {
    'peers':0.30,'services':0.05,'banned':0.10,'peer-detail':0.55,
    'blocks':0.35,'block-detail':0.35,'mining':0.30,
    'chain':0.35,'fee-heatmap':0.20,'block-timing':0.28,'fee-subsidy':0.17,
  },

  // Design-default column width ratios (fraction of #main width).
  // Only for the three resizable columns — col4 fills remaining space via flex.
  // These are the starting point on first load; user drags override via _colWidthRatios.
  _DEFAULT_COL_RATIO: {
    'col1': 0.18,
    'col2': 0.22,
    'col3': 0.26,
  },

  // User-set height ratios keyed by panel name. Populated on drag-end and
  // restored from localStorage. Takes priority over _DEFAULT_RATIO.
  _userRatios: {},

  // User-set (or default) column width ratios keyed by col.id.
  // Seeded from _DEFAULT_COL_RATIO on first load, then overwritten by user drags
  // and persisted to localStorage.
  _colWidthRatios: {},

  cols(){ return Array.from(this._main.querySelectorAll(':scope > .col-wrap')); },
  panelsIn(col){ return Array.from(col.querySelectorAll(':scope > .panel')); },

  // ── Initialisation ──────────────────────────────────────────────────────────

  init(){
    this.cols().forEach(col => this._rebuildBars(col));
    this._markPanels();
    this._initColResize();
    requestAnimationFrame(() => {
      this._loadLayout();
      this.cols().forEach(col => this._applyPanelRatios(col));
      this._applyColRatios();
      window.addEventListener('resize', () => {
        this._applyColRatios();
        this.cols().forEach(col => this._normaliseCol(col));
      });
    });
    document.querySelectorAll('.panel[data-panel]').forEach(p => this._initDrag(p));
    document.querySelectorAll('.panel[data-panel]').forEach(p => this._initPanelControls(p));
    new MutationObserver(() => {
      document.querySelectorAll('.panel[data-panel]').forEach(p => {
        this._initDrag(p);
        this._initPanelControls(p);
      });
    }).observe(this._main, {childList:true, subtree:true});
  },

  // ── Persistence ─────────────────────────────────────────────────────────────

  saveLayout(){
    try{
      const panelOrder = {};
      this.cols().forEach(col => {
        if(col.id)
          panelOrder[col.id] = this.panelsIn(col).map(p => p.dataset.panel).filter(Boolean);
      });
      const hidden = Array.from(this._hiddenPanels.keys())
        .map(p => p.dataset.panel).filter(Boolean);
      localStorage.setItem(this._LS_KEY, JSON.stringify({
        colWidthRatios: this._colWidthRatios,
        hidden, panelOrder, panelRatios: this._userRatios,
      }));
    }catch(_){}
  },

  _loadLayout(){
    try{
      const raw = localStorage.getItem(this._LS_KEY);
      if(!raw) return;
      const {colWidthRatios, colWidths, hidden=[], panelOrder={}, panelRatios={}} = JSON.parse(raw);

      // Restore user-set panel height ratios.
      this._userRatios = (panelRatios && typeof panelRatios === 'object') ? panelRatios : {};

      // Restore column width ratios. Support legacy colWidths (px) from older saves.
      if(colWidthRatios && typeof colWidthRatios === 'object'){
        this._colWidthRatios = colWidthRatios;
      } else if(colWidths && typeof colWidths === 'object'){
        const totalW = this._main.offsetWidth || window.innerWidth;
        this.cols().forEach(col => {
          if(col.id && colWidths[col.id])
            this._colWidthRatios[col.id] = Math.max(120, colWidths[col.id]) / totalW;
        });
      }

      // Restore panel order.
      this.cols().forEach(col => {
        if(!col.id || !panelOrder[col.id]) return;
        const rh = col.querySelector(':scope > .rhandle');
        panelOrder[col.id].forEach(name => {
          const panel = document.querySelector(`.panel[data-panel="${name}"]`);
          if(!panel) return;
          if(rh) col.insertBefore(panel, rh); else col.appendChild(panel);
        });
        this._rebuildBars(col);
      });

      this._markPanels();
      hidden.forEach(name => {
        const panel = document.querySelector(`.panel[data-panel="${name}"]`);
        if(panel) this.hidePanel(panel);
      });
    }catch(_){}
  },

  // ── Column sizing ────────────────────────────────────────────────────────────

  _applyColRatios(){
    const totalW = this._main.offsetWidth;
    if(!totalW) return;
    this.cols().forEach(col => {
      if(!col.classList.contains('resizable')) return;
      if(this._colWidthRatios[col.id] == null)
        this._colWidthRatios[col.id] = this._DEFAULT_COL_RATIO[col.id] ?? (1 / this.cols().length);
      col.style.width = Math.max(120, Math.round(this._colWidthRatios[col.id] * totalW)) + 'px';
    });
  },

  _initColResize(){
    document.querySelectorAll('.rhandle').forEach(handle => {
      if(handle._colInit) return; handle._colInit = true;
      const col = document.getElementById(handle.dataset.target);
      let x0, w0;
      handle.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        x0 = e.clientX; w0 = col.offsetWidth;
        handle.classList.add('dragging'); document.body.style.cursor = 'col-resize';
        const mv = ev => {
          const newW = Math.max(120, w0 + (ev.clientX - x0));
          col.style.width = newW + 'px';
          this._colWidthRatios[col.id] = newW / this._main.offsetWidth;
        };
        const up = () => {
          handle.classList.remove('dragging'); document.body.style.cursor = '';
          document.removeEventListener('mousemove', mv);
          document.removeEventListener('mouseup', up);
          this.saveLayout();
        };
        document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
      });
    });
  },

  // ── Panel sizing ─────────────────────────────────────────────────────────────

  _MIN_H: 68,

  // Raw desired ratio for a panel before normalisation.
  _ratioFor(panel){
    const name = panel.dataset.panel;
    if(this._userRatios[name] != null)  return this._userRatios[name];
    if(this._DEFAULT_RATIO[name] != null) return this._DEFAULT_RATIO[name];
    return null;
  },

  // Total column height minus resize-bar gaps.
  _availH(col, vis){
    return (col.offsetHeight || 400) - 6 * Math.max(0, vis.length - 1);
  },

  // Distribute heights across ALL visible panels so they always sum to exactly
  // the available column height. Steps:
  //   1. Seed each panel with its desired ratio (user > default > equal share).
  //   2. Normalise all ratios so they sum to 1.
  //   3. Convert to px, clamp each to _MIN_H, then redistribute any deficit
  //      by shaving from the largest panels — total always === avail.
  _applyPanelRatios(col){
    const vis   = this.panelsIn(col).filter(p => p.style.display !== 'none');
    if(!vis.length) return;
    const avail = this._availH(col, vis);
    const n     = vis.length;
    const MIN_H = this._MIN_H;

    // 1 — seed raw ratios
    let raw = vis.map(p => this._ratioFor(p) ?? (1 / n));

    // 2 — normalise to sum === 1
    const sum = raw.reduce((a, b) => a + b, 0);
    raw = raw.map(r => r / sum);

    // 3 — convert to px and enforce minimum
    let heights = raw.map(r => Math.round(avail * r));
    let deficit = 0;
    heights = heights.map(h => { if(h < MIN_H){ deficit += MIN_H - h; return MIN_H; } return h; });

    // Redistribute deficit by shaving from largest panels first
    if(deficit > 0){
      const order = heights.map((h,i) => i).sort((a,b) => heights[b]-heights[a]);
      for(const i of order){
        const shave = Math.min(heights[i] - MIN_H, deficit);
        heights[i] -= shave; deficit -= shave;
        if(deficit <= 0) break;
      }
    }

    // Correct rounding: distribute remainder across panels proportionally,
    // starting from the largest, so no single panel absorbs a visible jump.
    const total = heights.reduce((a,b) => a+b, 0);
    let rem = avail - total;
    if(rem !== 0){
      const order = heights.map((_,i) => i).sort((a,b) => heights[b]-heights[a]);
      for(const i of order){
        if(rem === 0) break;
        const delta = rem > 0 ? 1 : -1;
        if(heights[i] - delta >= MIN_H){ heights[i] += delta; rem -= delta; }
      }
    }

    // Apply explicit px height to every panel — no flex fill, no special cases.
    vis.forEach((p, i) => { p.style.height = heights[i] + 'px'; });
    this._markPanels();
  },

  // Snapshot current panel heights as ratios — called after every user drag.
  _captureRatios(col){
    const vis = this.panelsIn(col).filter(p => p.style.display !== 'none');
    if(!vis.length) return;
    const avail = this._availH(col, vis);
    if(!avail) return;
    vis.forEach(p => {
      if(p.offsetHeight && p.dataset.panel)
        this._userRatios[p.dataset.panel] = p.offsetHeight / avail;
    });
    this.saveLayout();
  },

  // Called on drop / window resize: redistribute so everything fits.
  _normaliseCol(col){
    const vis = this.panelsIn(col).filter(p => p.style.display !== 'none');
    if(!vis.length){ this._rebuildBars(col); this._markPanels(); return; }
    this._applyPanelRatios(col);
    this._rebuildBars(col); this._markPanels();
  },

  // ── Panel resize bars ────────────────────────────────────────────────────────

  _markPanels(){
    this.cols().forEach(col => {
      const ps  = this.panelsIn(col);
      const vis = ps.filter(p => p.style.display !== 'none');
      ps.forEach((p, i) => {
        p.classList.toggle('panel-first', i === 0);
        p.classList.toggle('panel-last',  i === ps.length - 1);
        p.style.flex = '0 0 auto';   // every panel is explicit px, no flex fill
      });
      const rh = col.querySelector(':scope > .rhandle');
      if(rh) rh.style.display = vis.length === 0 ? 'none' : '';
    });
  },

  _rebuildBars(col){
    col.querySelectorAll(':scope > .panel-resize-bar').forEach(b => b.remove());
    const vis = this.panelsIn(col).filter(p => p.style.display !== 'none');
    vis.forEach((p, i) => {
      if(i < vis.length - 1){
        const bar = document.createElement('div');
        bar.className = 'panel-resize-bar';
        // Insert before next visible panel, NOT after current. p.after(bar)
        // would place the bar before hidden panels sitting between the two
        // visible ones in the DOM, causing the resize walker to find them.
        vis[i + 1].before(bar);
        this._initBar(bar, p);
      }
    });
  },

  _initBar(bar, topPanel){
    bar.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const MIN_H = this._MIN_H;
      // Walk forward to find the next VISIBLE panel. Hidden panels (display:none)
      // have offsetHeight 0 which collapses the resize budget to nothing,
      // causing the snap-up bug on every drag.
      let bot = bar.nextElementSibling;
      while(bot && (!bot.classList.contains('panel') || bot.style.display === 'none')) bot = bot.nextElementSibling;
      if(!bot || !bot.offsetHeight) return; // no valid bottom panel — bail
      const y0  = e.clientY;
      const h0  = topPanel.offsetHeight;
      const bh0 = bot ? bot.offsetHeight : 0;
      // Total budget shared between the two panels around this bar.
      const budget = h0 + bh0;
      const col = topPanel.closest('.col-wrap');
      bar.classList.add('dragging'); document.body.style.cursor = 'row-resize';
      const mv = ev => {
        const dy     = ev.clientY - y0;
        const newTop = Math.min(Math.max(MIN_H, h0 + dy), budget - MIN_H);
        topPanel.style.height = newTop + 'px';
        if(bot) bot.style.height = Math.max(MIN_H, budget - newTop) + 'px';
      };
      const up = () => {
        bar.classList.remove('dragging'); document.body.style.cursor = '';
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
        if(col) this._captureRatios(col);
      };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
  },

  hidePanel(panel){
    if(!panel) return;
    this._hiddenPanels.set(panel, panel.style.height || '');
    panel.style.display = 'none';
    const col = panel.parentElement;
    this._rebuildBars(col);
    this._applyPanelRatios(col);   // redistribute freed space immediately
    this._updateHiddenPills(); this.saveLayout();
  },

  restorePanel(panel){
    panel.style.display='';
    this._hiddenPanels.delete(panel);
    const col = panel.parentElement;
    this._rebuildBars(col);
    this._applyPanelRatios(col);   // redistribute so nothing overflows
    this._updateHiddenPills(); this.saveLayout();
  },

  _updateHiddenPills(){
    const wrap=document.getElementById('sb-hidden-wrap');
    if(!wrap) return;
    if(this._hiddenPanels.size===0){ wrap.innerHTML=''; return; }
    wrap.innerHTML=Array.from(this._hiddenPanels.keys()).map(p=>
      `<span class="sb-hidden-pill" data-restore="${p.dataset.panel||'panel'}">+ ${p.dataset.panel||'panel'}</span>`
    ).join('');
    wrap.querySelectorAll('.sb-hidden-pill').forEach(pill=>{
      pill.addEventListener('click',()=>{
        const panel=document.querySelector(`.panel[data-panel="${pill.dataset.restore}"]`);
        if(panel) this.restorePanel(panel);
      });
    });
  },

  _initPanelControls(panel){
    if(panel._ctxInit) return; panel._ctxInit=true;
    const name = panel.dataset.panel || 'panel';
    const ph=panel.querySelector('.ph');
    if(ph){
      ph.setAttribute('aria-label', name + ' panel — drag to reorder');
      ph.addEventListener('contextmenu',e=>{ e.preventDefault(); e.stopPropagation(); contextMenu.show(panel,e.clientX+2,e.clientY+2); });
    }
    const closeBtn=panel.querySelector('.ph-close');
    if(closeBtn){
      closeBtn.setAttribute('aria-label', 'Hide ' + name + ' panel');
      closeBtn.addEventListener('click',e=>{ e.stopPropagation(); this.hidePanel(panel); });
    }
  },

  _initDrag(panel){
    if(panel._dragInit) return; panel._dragInit=true;
    const ph=panel.querySelector('.ph'); if(!ph) return;
    let dragPanel=null, ghost=null, dropIndicator=null, lastDrop=null;
    ph.addEventListener('mousedown',e=>{
      if(e.target.closest('.ph-right')) return;
      e.preventDefault();
      let moved=false; const ox=e.clientX, oy=e.clientY;
      const mv=ev=>{
        if(!moved&&Math.hypot(ev.clientX-ox,ev.clientY-oy)<4) return;
        if(!moved){
          moved=true; dragPanel=panel; panel.classList.add('dragging-src');
          const rect=panel.getBoundingClientRect();
          ghost=document.createElement('div'); ghost.className='drag-ghost';
          ghost.style.cssText=`width:${rect.width}px;height:${rect.height}px;left:${rect.left}px;top:${rect.top}px;transition:none`;
          Array.from(panel.children).forEach(child=>ghost.appendChild(child.cloneNode(true)));
          document.body.appendChild(ghost);
          ghost._ox=ev.clientX-rect.left; ghost._oy=ev.clientY-rect.top;
        }
        ghost.style.left=(ev.clientX-ghost._ox)+'px'; ghost.style.top=(ev.clientY-ghost._oy)+'px';
        let overCol=null;
        this.cols().forEach(c=>{ const r=c.getBoundingClientRect(); if(ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom) overCol=c; });
        this.cols().forEach(c=>c.classList.remove('drop-target-col'));
        dropIndicator&&dropIndicator.remove();
        if(overCol){
          overCol.classList.add('drop-target-col');
          let before=null;
          for(const p of this.panelsIn(overCol)){ if(p===panel) continue; const r=p.getBoundingClientRect(); if(ev.clientY<r.top+r.height/2){before=p;break;} }
          if(!dropIndicator){ dropIndicator=document.createElement('div'); dropIndicator.className='drop-indicator'; }
          const rh=overCol.querySelector(':scope > .rhandle');
          if(before) overCol.insertBefore(dropIndicator,before); else if(rh) overCol.insertBefore(dropIndicator,rh); else overCol.appendChild(dropIndicator);
          lastDrop={col:overCol,before};
        } else lastDrop=null;
      };
      const up=()=>{
        document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up);
        document.body.style.cursor='';
        if(moved&&dragPanel&&lastDrop){
          const oldCol=dragPanel.parentElement;
          const nx=dragPanel.nextElementSibling;
          if(nx&&nx.classList.contains('panel-resize-bar')) nx.remove();
          dragPanel.remove(); this._normaliseCol(oldCol);
          const rh=lastDrop.col.querySelector(':scope > .rhandle');
          if(lastDrop.before) lastDrop.col.insertBefore(dragPanel,lastDrop.before);
          else if(rh) lastDrop.col.insertBefore(dragPanel,rh);
          else lastDrop.col.appendChild(dragPanel);
          this._normaliseCol(lastDrop.col);
          this.saveLayout();
        }
        panel.classList.remove('dragging-src');
        ghost&&ghost.remove(); ghost=null;
        dropIndicator&&dropIndicator.remove(); dropIndicator=null;
        this.cols().forEach(c=>c.classList.remove('drop-target-col'));
        dragPanel=null; lastDrop=null;
      };
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════════
const contextMenu = {
  _el: document.getElementById('ctx-menu'),

  show(panel, x, y){
    this._el.innerHTML=`<div class="ctx-item" data-action="hide"><span class="ctx-icon">◻</span>hide panel</div>`;
    this._el.querySelector('[data-action="hide"]').addEventListener('click',()=>{ layout.hidePanel(panel); this.hide(); });
    this._el.style.display='block';
    const mw=this._el.offsetWidth, mh=this._el.offsetHeight;
    this._el.style.left=Math.min(x,window.innerWidth-mw-6)+'px';
    this._el.style.top= Math.min(y,window.innerHeight-mh-6)+'px';
  },

  hide(){ this._el.style.display='none'; },
};


// ═══════════════════════════════════════════════════════════════════════════════
// POLLER — fetch, rate state, retry countdown, polling schedule
// ═══════════════════════════════════════════════════════════════════════════════
const poller = {
  _prevTotals: null,
  _prevFetchAt: null,
  _failCount: 0,
  _retryTimer: null,
  _pollTimer: null,
  _fetching: false,
  _hadSuccess: false,
  _lastSync: false,
  _lastFetchAt: null,

  async fetchNow(){
    if(this._fetching) return;
    this._fetching=true;
    if(this._retryTimer){ clearInterval(this._retryTimer); this._retryTimer=null; }
    try{
      const res=await fetch('/api/data',{signal:AbortSignal.timeout(15000)});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const raw=await res.json();
      if(raw.error) throw new Error(raw.error);

      // Compute bandwidth rates from totals delta
      const nt=raw.netTotals||{};
      const nowT=Date.now()/1000;
      const totalSent=nt.totalbytessent||0, totalRecv=nt.totalbytesrecv||0;
      let sentRate=0, recvRate=0;
      if(this._prevTotals&&this._prevFetchAt){
        if(totalSent>=this._prevTotals.sent&&totalRecv>=this._prevTotals.recv){
          const dt=Math.max(1,nowT-this._prevFetchAt);
          sentRate=(totalSent-this._prevTotals.sent)/dt;
          recvRate=(totalRecv-this._prevTotals.recv)/dt;
        }
      }
      this._prevTotals={sent:totalSent,recv:totalRecv};
      this._prevFetchAt=nowT;
      network.push(sentRate,recvRate);

      this._failCount=0;
      this._hadSuccess=true;
      this._lastFetchAt=Date.now();
      set('sb-err','');
      document.getElementById('connecting').style.display='none';

      const d={...raw,netIn:recvRate,netOut:sentRate,totalRecv,totalSent};
      this._lastData=d;
      renderAll(d);

    }catch(e){
      this._failCount++;
      set('sb-err',e.message);
      document.getElementById('live-dot').className='dot err';
      set('conn-msg',e.message);
      const overlay=document.getElementById('connecting');
      if(overlay&&!this._hadSuccess) overlay.style.display='flex';
      this._startRetryCountdown(Math.min(5+this._failCount*5,30));
    }finally{
      this._fetching=false;
    }
  },

  _startRetryCountdown(delay){
    let t=delay;
    const cdEl=document.getElementById('conn-countdown');
    const btn=document.getElementById('conn-retry');
    if(btn) btn.style.display='inline-block';
    if(cdEl) cdEl.textContent='retrying in '+t+'s…';
    clearInterval(this._retryTimer);
    this._retryTimer=setInterval(()=>{
      t--;
      if(cdEl) cdEl.textContent=t>0?'retrying in '+t+'s…':'retrying…';
      if(t<=0){ clearInterval(this._retryTimer); this._retryTimer=null; if(btn) btn.style.display='none'; if(cdEl) cdEl.textContent=''; this.fetchNow(); }
    },1000);
  },

  retryNow(){
    clearInterval(this._retryTimer); this._retryTimer=null;
    set('conn-countdown','');
    const btn=document.getElementById('conn-retry');
    if(btn) btn.style.display='none';
    this.fetchNow();
  },

  schedule(){
    clearInterval(this._pollTimer);
    const interval=this._lastSync?30000:10000;
    this._pollTimer=setInterval(async()=>{
      const prev=this._lastSync;
      await this.fetchNow();
      if(this._lastSync!==prev) this.schedule();
    },interval);
  },

  setSync(syncing){ this._lastSync=syncing; },
  getLastFetchAt(){ return this._lastFetchAt; },

  exportJSON(){
    if(!this._lastData) return;
    const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([JSON.stringify(this._lastData,null,2)],{type:'application/json'}));
    a.download=`blockwatch-${ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// RENDER ALL — thin coordinator, each module fails independently
// ═══════════════════════════════════════════════════════════════════════════════
function safeRender(name, fn){
  try{ fn(); }
  catch(e){ console.error('[render:'+name+']', e.message, e.stack); }
}

function renderAll(d){
  poller.setSync(d.blockchain?.initialblockdownload||false);

  safeRender('node',        ()=> nodePanel.render(d));
  safeRender('chain',       ()=> chainPanel.render(d));
  safeRender('network',     ()=> network.render(d.netIn, d.netOut, d.totalRecv, d.totalSent));
  safeRender('peers',       ()=> peersPanel.render(d));
  safeRender('blocks',      ()=> blocksPanel.render(d));
  safeRender('feeHeatmap',  ()=> charts.feeHeatmap.draw(d.blocks||[]));
  safeRender('feeSubsidy',  ()=> charts.feeSubsidy.draw(d.blocks||[]));
  safeRender('blockTiming', ()=> charts.blockTiming.draw(d.blocks||[]));
}



// ═══════════════════════════════════════════════════════════════════════════════
// BOOT — wire events, init modules, start polling
// ═══════════════════════════════════════════════════════════════════════════════

// Layout
layout.init();

// Charts resize observers
charts.init();

// Global copy-to-clipboard delegation
document.addEventListener('click', e=>{
  const el=e.target.closest('[data-copy]');
  if(!el||!el.dataset.copy) return;
  if(e.target.closest('a')) return;
  e.stopPropagation();
  utils.copyToClipboard(el.dataset.copy, el);
});

// Context menu dismiss
document.addEventListener('click', ()=>contextMenu.hide());

// Keyboard shortcut: r = refresh
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.key==='r'||e.key==='R') poller.fetchNow();
});

// Hide peer detail tabs until a peer is selected
const _pdTabs=document.getElementById('pd-tabs');
if(_pdTabs) _pdTabs.style.display='none';

// Peer table click delegation
document.getElementById('peer-table-body')?.addEventListener('click', e=>{
  const row=e.target.closest('tr');
  if(!row||!row.dataset.pid) return;
  peersPanel.selectById(parseInt(row.dataset.pid,10));
});

// Block table click delegation
document.getElementById('blk-body')?.addEventListener('click', e=>{
  if(e.target.closest('a')) return;
  const row=e.target.closest('tr[data-bheight]');
  if(!row) return;
  blocksPanel.selectByHeight(parseInt(row.dataset.bheight,10));
});

// Button listeners
document.getElementById('conn-retry')?.addEventListener('click', ()=>poller.retryNow());
document.getElementById('la-reveal-btn')?.addEventListener('click', ()=>nodePanel.toggleLocalAddrs());
document.getElementById('peers-tsv-btn')?.addEventListener('click', ()=>peersPanel.exportTSV());
document.getElementById('snapshot-btn')?.addEventListener('click', ()=>poller.exportJSON());

// Ban list — immediate + every 60s
banList.refresh();
setInterval(()=>banList.refresh(), 60000);

// Clock + staleness indicator — every second
setInterval(()=>{
  set('clock', new Date().toISOString().slice(0,19).replace('T',' '));
  const stale=document.getElementById('sb-stale');
  if(!stale) return;
  const lastAt=poller.getLastFetchAt();
  if(!lastAt){ stale.textContent=''; return; }
  const age=Math.floor((Date.now()-lastAt)/1000);
  const dot=document.getElementById('live-dot');
  if(age<30){
    stale.textContent=''; stale.className='sb-stale';
    if(dot&&!dot.classList.contains('err')) dot.className='dot ok';
  } else if(age<60){
    stale.textContent=age+'s ago'; stale.className='sb-stale';
    if(dot&&!dot.classList.contains('err')) dot.className='dot warn';
  } else {
    stale.textContent=Math.floor(age/60)+'m ago'; stale.className='sb-stale warn';
    if(dot) dot.className='dot err';
  }
},1000);

// Tab visibility — pause polling when hidden, resume on return
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    clearInterval(poller._pollTimer); poller._pollTimer=null;
  } else {
    poller.fetchNow().then(()=>poller.schedule());
  }
});

// Start
poller.fetchNow().then(()=>poller.schedule());

})(); // end IIFE