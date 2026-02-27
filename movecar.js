/**
 * MoveCar 多用户智能挪车系统 - v2.1
 * 优化：30分钟断点续传 + 域名优先级二维码 + 多用户隔离
 */

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const CONFIG = {
  KV_TTL: 3600,         // 坐标等数据有效期：1 小时
  SESSION_TTL: 1800,    // 挪车会话有效期：30 分钟 (1800秒)
  RATE_LIMIT_TTL: 60    // 频率限制：60 秒
}

async function handleRequest(request) {
  const url = new URL(request.url)
  const path = url.pathname
  const userParam = url.searchParams.get('u') || 'default';
  const userKey = userParam.toLowerCase();

  // 1. 二维码生成工具
  if (path === '/qr') return renderQRPage(url.origin, userKey);

  // 2. API 路由
  if (path === '/api/notify' && request.method === 'POST') return handleNotify(request, url, userKey);
  if (path === '/api/get-location') return handleGetLocation(userKey);
  if (path === '/api/owner-confirm' && request.method === 'POST') return handleOwnerConfirmAction(request, userKey);
  
  // 查询状态 API (带 Session 校验)
  if (path === '/api/check-status') {
    const s = url.searchParams.get('s');
    return handleCheckStatus(userKey, s);
  }

  // 3. 页面路由
  if (path === '/owner-confirm') return renderOwnerPage(userKey);

  // 默认进入挪车首页
  return renderMainPage(url.origin, userKey);
}

/** 配置读取 **/
function getUserConfig(userKey, envPrefix) {
  const specificKey = envPrefix + "_" + userKey.toUpperCase();
  if (typeof globalThis[specificKey] !== 'undefined') return globalThis[specificKey];
  if (typeof globalThis[envPrefix] !== 'undefined') return globalThis[envPrefix];
  return null;
}

// 坐标转换 (WGS-84 -> GCJ-02)
function wgs84ToGcj02(lat, lng) {
  const a = 6378245.0; const ee = 0.00669342162296594323;
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat, lng };
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat); magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}
function generateMapUrls(lat, lng) {
  const gcj = wgs84ToGcj02(lat, lng);
  return {
    amapUrl: "https://uri.amap.com/marker?position=" + gcj.lng + "," + gcj.lat + "&name=扫码者位置",
    appleUrl: "https://maps.apple.com/?ll=" + gcj.lat + "," + gcj.lng + "&q=扫码者位置"
  };
}

/** 发送通知逻辑 **/
async function handleNotify(request, url, userKey) {
  try {
    if (typeof MOVE_CAR_STATUS === 'undefined') throw new Error('KV 未绑定');
    const lockKey = "lock_" + userKey;
    const isLocked = await MOVE_CAR_STATUS.get(lockKey);
    if (isLocked) throw new Error('发送频率过快，请一分钟后再试');

    const body = await request.json();
    const sessionId = body.sessionId; 

    const ppToken = getUserConfig(userKey, 'PUSHPLUS_TOKEN');
    const barkUrl = getUserConfig(userKey, 'BARK_URL');
    const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
    const baseDomain = (typeof globalThis.EXTERNAL_URL !== 'undefined' && globalThis.EXTERNAL_URL) ? globalThis.EXTERNAL_URL.replace(/\/$/, "") : url.origin;
    const confirmUrl = baseDomain + "/owner-confirm?u=" + userKey;

    let notifyText = "🚗 挪车请求【" + carTitle + "】\\n💬 留言: " + (body.message || '车旁有人等待');
    
    // 存储当前会话信息，有效期设为 30 分钟
    const statusData = { status: 'waiting', sessionId: sessionId };
    
    if (body.location && body.location.lat) {
      const maps = generateMapUrls(body.location.lat, body.location.lng);
      await MOVE_CAR_STATUS.put("loc_" + userKey, JSON.stringify({ ...body.location, ...maps }), { expirationTtl: CONFIG.KV_TTL });
    }

    await MOVE_CAR_STATUS.put("status_" + userKey, JSON.stringify(statusData), { expirationTtl: CONFIG.SESSION_TTL });
    await MOVE_CAR_STATUS.put(lockKey, '1', { expirationTtl: CONFIG.RATE_LIMIT_TTL });

    const tasks = [];
    if (ppToken) tasks.push(fetch('http://www.pushplus.plus/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: ppToken, title: "🚗 挪车请求：" + carTitle, content: notifyText.replace(/\\n/g, '<br>') + '<br><br><a href="' + confirmUrl + '" style="font-size:18px;color:#0093E9">【点击处理】</a>', template: 'html' }) }));
    if (barkUrl) tasks.push(fetch(barkUrl + "/" + encodeURIComponent('挪车请求') + "/" + encodeURIComponent(notifyText) + "?url=" + encodeURIComponent(confirmUrl)));

    await Promise.all(tasks);
    return new Response(JSON.stringify({ success: true }));
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500 });
  }
}

async function handleCheckStatus(userKey, clientSessionId) {
  const data = await MOVE_CAR_STATUS.get("status_" + userKey);
  if (!data) return new Response(JSON.stringify({ status: 'none' }));

  const statusObj = JSON.parse(data);
  if (statusObj.sessionId !== clientSessionId) {
    return new Response(JSON.stringify({ status: 'none' }));
  }

  const ownerLoc = await MOVE_CAR_STATUS.get("owner_loc_" + userKey);
  return new Response(JSON.stringify({ 
    status: statusObj.status, 
    ownerLocation: ownerLoc ? JSON.parse(ownerLoc) : null 
  }));
}

async function handleGetLocation(userKey) {
  const data = await MOVE_CAR_STATUS.get("loc_" + userKey);
  return new Response(data || '{}');
}

async function handleOwnerConfirmAction(request, userKey) {
  const body = await request.json();
  const data = await MOVE_CAR_STATUS.get("status_" + userKey);
  if (data) {
    const statusObj = JSON.parse(data);
    statusObj.status = 'confirmed';
    if (body.location) {
      const urls = generateMapUrls(body.location.lat, body.location.lng);
      await MOVE_CAR_STATUS.put("owner_loc_" + userKey, JSON.stringify({ ...body.location, ...urls }), { expirationTtl: 600 });
    }
    // 确认后状态继续保持，直到 SESSION_TTL 到期
    await MOVE_CAR_STATUS.put("status_" + userKey, JSON.stringify(statusObj), { expirationTtl: 600 });
  }
  return new Response(JSON.stringify({ success: true }));
}

/** 功能：二维码生成工具页 **/
function renderQRPage(origin, userKey) {
  const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
  let baseDomain = (typeof globalThis.EXTERNAL_URL !== 'undefined' && globalThis.EXTERNAL_URL) ? globalThis.EXTERNAL_URL.replace(/\/$/, "") : origin;
  const targetUrl = baseDomain + "/?u=" + userKey;
  return new Response(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>制作挪车码</title>
  <style>
    body { font-family: sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .qr-card { background: white; padding: 40px 20px; border-radius: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.05); text-align: center; width: 90%; max-width: 380px; }
    .qr-img { width: 250px; height: 250px; margin: 25px auto; border: 1px solid #f1f5f9; padding: 8px; border-radius: 12px; }
    .btn { display: block; background: #0093E9; color: white; text-decoration: none; padding: 16px; border-radius: 16px; font-weight: bold; margin-top: 20px; }
    .url-info { font-size: 11px; color: #cbd5e1; margin-top: 15px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="qr-card">
    <h2 style="color:#1e293b">${carTitle} 的专属挪车码</h2>
    <p style="color:#64748b; font-size:14px; margin-top:8px">扫码通知，保护隐私</p>
    <img class="qr-img" src="https://api.qrserver.com/v1/create-qr-code/?size=450x450&data=${encodeURIComponent(targetUrl)}">
    <a href="javascript:window.print()" class="btn">🖨️ 立即打印挪车牌</a>
    <div class="url-info">${targetUrl}</div>
  </div>
</body>
</html>
`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

/** 界面渲染：扫码者页 **/
function renderMainPage(origin, userKey) {
  const phone = getUserConfig(userKey, 'PHONE_NUMBER') || '';
  const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
  const phoneHtml = phone ? '<a href="tel:' + phone + '" class="btn-phone">📞 拨打车主电话</a>' : '';

  return new Response(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
  <title>挪车通知</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: linear-gradient(160deg, #0093E9 0%, #80D0C7 100%); min-height: 100vh; padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 500px; display: flex; flex-direction: column; gap: 15px; }
    .card { background: white; border-radius: 24px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
    .header { text-align: center; }
    .icon-wrap { width: 64px; height: 64px; background: #0093E9; border-radius: 20px; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; font-size: 32px; color: white; }
    textarea { width: 100%; min-height: 90px; border: 1px solid #eee; border-radius: 14px; padding: 15px; font-size: 16px; outline: none; margin-top: 10px; background:#fcfcfc; resize:none; }
    .tag { display: inline-block; background: #f1f5f9; padding: 10px 16px; border-radius: 20px; font-size: 14px; margin: 5px 3px; cursor: pointer; color:#475569; }
    .btn-main { background: #0093E9; color: white; border: none; padding: 18px; border-radius: 18px; font-size: 18px; font-weight: bold; cursor: pointer; width: 100%; }
    .btn-phone { background: #ef4444; color: white; border: none; padding: 15px; border-radius: 15px; text-decoration: none; text-align: center; font-weight: bold; display: block; margin-top: 10px; }
    .hidden { display: none !important; }
    .map-links { display: flex; gap: 10px; margin-top: 15px; }
    .map-btn { flex: 1; padding: 14px; border-radius: 14px; text-align: center; text-decoration: none; color: white; font-weight: bold; }
    .amap { background: #1890ff; } .apple { background: #000; }
  </style>
</head>
<body>
  <div class="container" id="mainView">
    <div class="card header">
      <div class="icon-wrap">🚗</div>
      <h2 style="color:#1e293b">呼叫 ${carTitle}</h2>
      <p style="color:#64748b; font-size:14px; margin-top:5px">提示：车主将收到即时提醒</p>
    </div>
    <div class="card">
      <textarea id="msgInput" placeholder="请输入留言..."></textarea>
      <div style="margin-top:5px">
        <div class="tag" onclick="setTag('麻烦挪下车，谢谢')">🚧 挡路了</div>
        <div class="tag" onclick="setTag('临时停靠，请包涵')">⏱️ 临停</div>
        <div class="tag" onclick="setTag('有急事外出，速来')">🏃 急事</div>
      </div>
    </div>
    <div class="card" id="locStatus" style="font-size:13px; color:#94a3b8; text-align:center;">定位请求中...</div>
    <button id="notifyBtn" class="btn-main" onclick="sendNotify()">🔔 发送通知</button>
  </div>

  <div class="container hidden" id="successView">
    <div class="card" style="text-align:center">
      <div style="font-size:64px; margin-bottom:15px">📧</div>
      <h2 style="color:#1e293b">通知已送达</h2>
      <p style="color:#64748b">车主已收到挪车请求，请在车旁稍候</p>
    </div>
    <div id="ownerFeedback" class="card hidden" style="text-align:center; border: 2.5px solid #10b981;">
      <div style="font-size:40px">👨‍✈️</div>
      <h3 style="color:#059669">车主回复：马上到</h3>
      <div class="map-links">
        <a id="ownerAmap" href="#" class="map-btn amap">高德地图</a>
        <a id="ownerApple" href="#" class="map-btn apple">苹果地图</a>
      </div>
    </div>
    <div>
      <button class="btn-main" style="background:#f59e0b; margin-top:10px;" onclick="location.reload()">🔄 刷新状态</button>
      ${phoneHtml}
    </div>
  </div>

  <script>
    let userLoc = null;
    const userKey = "${userKey}";
    
    // 会话持久化
    let sessionId = localStorage.getItem('movecar_session_' + userKey);
    if (!sessionId) {
      sessionId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('movecar_session_' + userKey, sessionId);
    }

    window.onload = async () => {
      checkActiveSession();
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(p => {
          userLoc = { lat: p.coords.latitude, lng: p.coords.longitude };
          document.getElementById('locStatus').innerText = '📍 位置已锁定';
          document.getElementById('locStatus').style.color = '#10b981';
        }, () => {
          document.getElementById('locStatus').innerText = '📍 无法获取精确位置';
        });
      }
    };

    async function checkActiveSession() {
      try {
        const res = await fetch('/api/check-status?u=' + userKey + '&s=' + sessionId);
        const data = await res.json();
        if (data.status && data.status !== 'none') {
          showSuccess(data);
          pollStatus();
        }
      } catch(e){}
    }

    function setTag(t) { document.getElementById('msgInput').value = t; }

    async function sendNotify() {
      const btn = document.getElementById('notifyBtn');
      btn.disabled = true; btn.innerText = '正在联络车主...';
      try {
        const res = await fetch('/api/notify?u=' + userKey, {
          method: 'POST',
          body: JSON.stringify({ 
            message: document.getElementById('msgInput').value, 
            location: userLoc,
            sessionId: sessionId 
          })
        });
        const data = await res.json();
        if (data.success) {
          showSuccess({status: 'waiting'});
          pollStatus();
        } else { alert(data.error); btn.disabled = false; btn.innerText = '🔔 发送通知'; }
      } catch(e) { alert('服务暂时不可用'); btn.disabled = false; }
    }

    function showSuccess(data) {
      document.getElementById('mainView').classList.add('hidden');
      document.getElementById('successView').classList.remove('hidden');
      updateUI(data);
    }

    function updateUI(data) {
      if (data.status === 'confirmed') {
        document.getElementById('ownerFeedback').classList.remove('hidden');
        if (data.ownerLocation) {
          document.getElementById('ownerAmap').href = data.ownerLocation.amapUrl;
          document.getElementById('ownerApple').href = data.ownerLocation.appleUrl;
        }
      }
    }

    function pollStatus() {
      setInterval(async () => {
        try {
          const res = await fetch('/api/check-status?u=' + userKey + '&s=' + sessionId);
          const data = await res.json();
          updateUI(data);
        } catch(e){}
      }, 5000);
    }
  </script>
</body>
</html>
`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

/** 界面渲染：车主页 **/
function renderOwnerPage(userKey) {
  const carTitle = getUserConfig(userKey, 'CAR_TITLE') || '车主';
  return new Response(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>挪车处理</title>
  <style>
    body { font-family: sans-serif; background: #4f46e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin:0; padding:20px; }
    .card { background: white; padding: 35px 25px; border-radius: 30px; text-align: center; width: 100%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
    .btn { background: #10b981; color: white; border: none; width: 100%; padding: 20px; border-radius: 18px; font-size: 18px; font-weight: bold; cursor: pointer; margin-top: 20px; box-shadow: 0 5px 15px rgba(16,185,129,0.3); }
    .map-box { display: none; background: #f8fafc; padding: 20px; border-radius: 20px; margin-top: 15px; border: 1px solid #e2e8f0; }
    .map-btn { display: inline-block; padding: 12px 18px; background: #2563eb; color: white; text-decoration: none; border-radius: 12px; margin: 5px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size:50px">📣</div>
    <h2 style="margin:15px 0; color:#1e293b">${carTitle}</h2>
    <p style="color:#64748b">有人正在车旁等您，请确认：</p>
    <div id="mapArea" class="map-box">
      <p style="font-size:14px; color:#2563eb; margin-bottom:12px; font-weight:bold">对方实时位置 📍</p>
      <a id="amapLink" href="#" class="map-btn">高德地图</a>
      <a id="appleLink" href="#" class="map-btn" style="background:#000">苹果地图</a>
    </div>
    <button id="confirmBtn" class="btn" onclick="confirmMove()">🚀 我已知晓，马上过去</button>
  </div>
  <script>
    const userKey = "${userKey}";
    window.onload = async () => {
      const res = await fetch('/api/get-location?u=' + userKey);
      const data = await res.json();
      if(data.amapUrl) {
        document.getElementById('mapArea').style.display = 'block';
        document.getElementById('amapLink').href = data.amapUrl;
        document.getElementById('appleLink').href = data.appleUrl;
      }
    };
    async function confirmMove() {
      const btn = document.getElementById('confirmBtn');
      btn.innerText = '已告知对方 ✓'; btn.disabled = true; btn.style.background = '#94a3b8';
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async p => {
          await fetch('/api/owner-confirm?u=' + userKey, { method: 'POST', body: JSON.stringify({ location: {lat: p.coords.latitude, lng: p.coords.longitude} }) });
        }, async () => {
          await fetch('/api/owner-confirm?u=' + userKey, { method: 'POST', body: JSON.stringify({ location: null }) });
        });
      }
    }
  </script>
</body>
</html>
`, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}
