const API_BASE = window.location.origin;
const WS_BASE = API_BASE.replace('http', 'ws');

let map;
let markers = {};
let myMarker;
let currentRole = 'rescuer';
let currentDisasterId = null;
let userId = 'user_' + Math.random().toString(36).substr(2, 9);
let ws = null;
let sosActive = false;
let disasters = [];
let victims = {};

function initMap() {
    try {
        map = L.map('map', {
            zoomControl: false,
            attributionControl: true
        }).setView([37.5665, 126.9780], 15);

        L.control.zoom({ position: 'bottomright' }).addTo(map);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(map);

        setTimeout(() => {
            map.invalidateSize();
        }, 100);

        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    map.setView([pos.coords.latitude, pos.coords.longitude], 16);
                    addMyMarker(pos.coords.latitude, pos.coords.longitude);
                },
                () => {
                    addMyMarker(37.5665, 126.9780);
                }
            );
        } else {
            addMyMarker(37.5665, 126.9780);
        }
    } catch (e) {
        console.error('Map init error:', e);
    }
}

function addMyMarker(lat, lng) {
    if (!map) return;
    
    if (myMarker) {
        myMarker.setLatLng([lat, lng]);
    } else {
        const icon = L.divIcon({
            className: 'my-marker',
            html: `<div style="width:20px;height:20px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 2px 10px rgba(59,130,246,0.5);"></div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        myMarker = L.marker([lat, lng], { icon }).addTo(map);
    }
}

function addVictimMarker(id, lat, lng, battery) {
    if (!map) return;
    
    if (markers[id]) {
        markers[id].setLatLng([lat, lng]);
    } else {
        const icon = L.divIcon({
            className: 'victim-marker',
            html: `<div style="width:24px;height:24px;background:#f85149;border:3px solid white;border-radius:50%;box-shadow:0 2px 10px rgba(248,81,73,0.5);display:flex;align-items:center;justify-content:center;font-size:12px;">🆘</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        markers[id] = L.marker([lat, lng], { icon }).addTo(map);
    }
}

function addRescuerMarker(id, lat, lng) {
    if (!map) return;
    
    if (markers[id]) {
        markers[id].setLatLng([lat, lng]);
    } else {
        const icon = L.divIcon({
            className: 'rescuer-marker',
            html: `<div style="width:24px;height:24px;background:#f59e0b;border:3px solid white;border-radius:50%;box-shadow:0 2px 10px rgba(245,158,11,0.5);display:flex;align-items:center;justify-content:center;font-size:12px;">🦺</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        markers[id] = L.marker([lat, lng], { icon }).addTo(map);
    }
}

function setRole(role, event) {
    currentRole = role;
    
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    document.getElementById('rescuerPanel').style.display = role === 'rescuer' ? 'block' : 'none';
    document.getElementById('victimPanel').style.display = role === 'victim' ? 'block' : 'none';
    
    if (role === 'victim') {
        startLocationTracking();
    }
}

async function loadDisasters() {
    try {
        const response = await fetch(`${API_BASE}/api/v1/disasters`);
        if (!response.ok) throw new Error('Failed to load');
        disasters = await response.json();
        renderDisasterList();
        updateStats();
    } catch (error) {
        console.error('Failed to load disasters:', error);
        document.getElementById('disasterList').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #f85149;">
                재난 목록 로딩 실패
            </div>
        `;
    }
}

function renderDisasterList() {
    const list = document.getElementById('disasterList');
    
    if (disasters.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: #8b949e;">
                등록된 재난이 없습니다<br>
                <small>위의 버튼으로 재난을 생성하세요</small>
            </div>
        `;
        return;
    }
    
    list.innerHTML = disasters.map(d => `
        <div class="disaster-card ${currentDisasterId === d.id ? 'active' : ''}" 
             onclick="selectDisaster('${d.id}')">
            <span class="type ${d.type}">${getTypeLabel(d.type)}</span>
            <div class="title">${d.description || getTypeLabel(d.type)}</div>
            <div class="meta">
                ${d.participant_count || 0}명 참여 · ${d.victim_count || 0}명 피구조
            </div>
        </div>
    `).join('');
}

function getTypeLabel(type) {
    const labels = {
        fire: '🔥 화재',
        earthquake: '🌋 지진',
        flood: '🌊 홍수',
        collapse: '🏚️ 붕괴',
        other: '⚠️ 기타'
    };
    return labels[type] || type;
}

async function selectDisaster(disasterId) {
    currentDisasterId = disasterId;
    renderDisasterList();
    
    const disaster = disasters.find(d => d.id === disasterId);
    if (disaster && map) {
        map.setView([disaster.latitude, disaster.longitude], 16);
    }
    
    connectWebSocket(disasterId);
    showNotification('재난에 참가했습니다', 'success');
}

function connectWebSocket(disasterId) {
    if (ws) {
        ws.close();
    }
    
    const role = currentRole;
    const wsUrl = `${WS_BASE}/ws/location/${disasterId}?user_id=${userId}&role=${role}`;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            updateConnectionStatus(true);
            showNotification('실시간 연결됨', 'success');
        };
        
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (e) {
                console.error('Parse error:', e);
            }
        };
        
        ws.onclose = () => {
            updateConnectionStatus(false);
            setTimeout(() => {
                if (currentDisasterId) {
                    connectWebSocket(currentDisasterId);
                }
            }, 3000);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus(false);
        };
    } catch (e) {
        console.error('WebSocket connect error:', e);
    }
}

function handleWebSocketMessage(message) {
    const { type, payload } = message;
    
    switch (type) {
        case 'location_update':
            handleLocationUpdate(payload);
            break;
        case 'proximity_alert':
            handleProximityAlert(payload);
            break;
        case 'sound_alert':
            handleSoundAlert(payload);
            break;
        case 'rescue_complete':
            handleRescueComplete(payload);
            break;
        case 'battery_mode_change':
            handleBatteryModeChange(payload);
            break;
        case 'user_joined':
            showNotification(`${payload.role === 'rescuer' ? '구조자' : '피구조자'} 참가`, 'success');
            break;
        case 'user_left':
            showNotification('사용자 퇴장', 'alert');
            break;
        case 'pong':
            break;
    }
}

function handleLocationUpdate(payload) {
    const { user_id, latitude, longitude, battery_level } = payload;
    
    if (user_id === userId) return;
    
    if (currentRole === 'rescuer') {
        addVictimMarker(user_id, latitude, longitude, battery_level);
        updateVictimList(user_id, latitude, longitude, battery_level);
    } else {
        addRescuerMarker(user_id, latitude, longitude);
    }
}

function handleProximityAlert(payload) {
    const { victim_id, distance_meters, alert_type } = payload;
    
    if (alert_type === 'found') {
        showNotification(`🚨 피구조자 발견! (${distance_meters.toFixed(1)}m)`, 'alert');
    } else if (alert_type === 'siren') {
        showNotification(`🚨 매우 근접! (${distance_meters.toFixed(1)}m)`, 'alert');
    } else {
        showNotification(`⚠️ 접근 중 (${distance_meters.toFixed(1)}m)`, 'success');
    }
}

function handleSoundAlert(payload) {
    if (currentRole === 'victim') {
        const { alert_type, distance_meters } = payload;
        
        if (alert_type === 'found') {
            showNotification(`🚨 구조자가 발견했습니다! (${distance_meters.toFixed(1)}m)`, 'alert');
        } else if (alert_type === 'siren') {
            showNotification(`🚨 구조자가 매우 가깝습니다! (${distance_meters.toFixed(1)}m)`, 'alert');
        } else {
            showNotification(`⚠️ 구조자가 접근 중입니다 (${distance_meters.toFixed(1)}m)`, 'success');
        }
    }
}

function handleRescueComplete(payload) {
    showNotification('✅ 구조 완료!', 'success');
    sosActive = false;
    const sosBtn = document.getElementById('sosBtn');
    if (sosBtn) {
        sosBtn.textContent = '🆘 SOS 호출';
        sosBtn.classList.remove('active');
    }
}

function handleBatteryModeChange(payload) {
    showNotification(`🔋 배터리 모드: ${payload.description || ''}`, 'success');
}

function updateVictimList(victimId, lat, lng, battery) {
    victims[victimId] = { lat, lng, battery, lastUpdate: Date.now() };
    
    const list = document.getElementById('victimList');
    const entries = Object.entries(victims);
    
    if (entries.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #8b949e; font-size: 13px;">
                피구조자가 없습니다
            </div>
        `;
        return;
    }
    
    list.innerHTML = entries.map(([id, data]) => `
        <div class="victim-item">
            <div class="info">
                <span style="font-size: 16px;">🆘</span>
                <span style="font-size: 13px;">${id.substring(0, 8)}...</span>
            </div>
            <div>
                <span class="battery">🔋 ${data.battery || '--'}%</span>
            </div>
        </div>
    `).join('');
}

function updateConnectionStatus(connected) {
    const dot = document.getElementById('wsStatusDot');
    const text = document.getElementById('wsStatusText');
    
    if (dot) dot.className = `status-dot ${connected ? 'online' : 'offline'}`;
    if (text) text.textContent = connected ? '실시간 연결됨' : '연결 끊김';
}

function updateStats() {
    const active = disasters.filter(d => d.status === 'active').length;
    const rescuers = disasters.reduce((sum, d) => sum + (d.participant_count || 0), 0);
    const victimCount = disasters.reduce((sum, d) => sum + (d.victim_count || 0), 0);
    
    document.getElementById('activeDisasters').textContent = active;
    document.getElementById('totalRescuers').textContent = rescuers;
    document.getElementById('totalVictims').textContent = victimCount;
}

function openCreateModal() {
    document.getElementById('createModal').classList.add('show');
}

function closeCreateModal() {
    document.getElementById('createModal').classList.remove('show');
}

async function createDisaster(event) {
    event.preventDefault();
    
    const type = document.getElementById('disasterType').value;
    const description = document.getElementById('disasterDesc').value;
    const radius = parseInt(document.getElementById('disasterRadius').value) || 500;
    
    let lat = 37.5665;
    let lng = 126.9780;
    
    if (map) {
        const center = map.getCenter();
        lat = center.lat;
        lng = center.lng;
    }
    
    try {
        const response = await fetch(`${API_BASE}/api/v1/disasters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type,
                latitude: lat,
                longitude: lng,
                radius_meters: radius,
                description: description || getTypeLabel(type)
            })
        });
        
        if (response.ok) {
            closeCreateModal();
            await loadDisasters();
            showNotification('재난이 생성되었습니다', 'success');
            
            document.getElementById('disasterDesc').value = '';
            document.getElementById('disasterRadius').value = '500';
        } else {
            const err = await response.text();
            console.error('Create failed:', err);
            showNotification('재난 생성 실패', 'alert');
        }
    } catch (error) {
        console.error('Create error:', error);
        showNotification('재난 생성 실패: 서버 연결 오류', 'alert');
    }
}

function toggleSos() {
    sosActive = !sosActive;
    const btn = document.getElementById('sosBtn');
    
    if (sosActive) {
        btn.textContent = '🚨 SOS 활성화됨';
        btn.classList.add('active');
        startLocationTracking();
        showNotification('SOS 호출이 활성화되었습니다', 'alert');
    } else {
        btn.textContent = '🆘 SOS 호출';
        btn.classList.remove('active');
        showNotification('SOS가 비활성화되었습니다', 'success');
    }
}

function startLocationTracking() {
    if (!navigator.geolocation) {
        showNotification('위치 서비스를 사용할 수 없습니다', 'alert');
        return;
    }
    
    navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            
            addMyMarker(latitude, longitude);
            
            const myLocationEl = document.getElementById('myLocation');
            if (myLocationEl) {
                myLocationEl.textContent = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
            }
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'location_update',
                    payload: {
                        user_id: userId,
                        disaster_id: currentDisasterId,
                        latitude,
                        longitude,
                        accuracy,
                        battery_level: null,
                        wifi_aps: [],
                        sensor_data: {}
                    }
                }));
            }
        },
        (error) => {
            console.error('Location error:', error);
            addMyMarker(37.5665, 126.9780);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        }
    );
    
    if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
            updateBatteryDisplay(battery.level * 100);
            battery.addEventListener('levelchange', () => {
                updateBatteryDisplay(battery.level * 100);
            });
        });
    }
}

function updateBatteryDisplay(level) {
    const el = document.getElementById('myBattery');
    if (el) el.textContent = `${Math.round(level)}%`;
}

function showNotification(text, type = 'success') {
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    
    if (!notification || !notificationText) return;
    
    notificationText.textContent = text;
    notification.className = `notification ${type} show`;
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

function sendPing() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', payload: {} }));
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadDisasters();
    
    setInterval(loadDisasters, 15000);
    setInterval(sendPing, 30000);
    
    document.getElementById('createModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('createModal')) {
            closeCreateModal();
        }
    });
});
