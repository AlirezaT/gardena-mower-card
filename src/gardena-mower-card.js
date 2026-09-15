/* Gardena Mower Card — dependency-free Home Assistant custom card. */
(() => {
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const VERSION = '__VERSION__';
const assetURL = name => { const url=new URL(name,import.meta.url); url.searchParams.set('v',VERSION); return url.href; };
const SCENE_CSS = assetURL('scene.css');
let lottieReady;
function loadLottie() {
  if (!lottieReady) lottieReady = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetURL('lottie-light-5.13.0.js');
    script.onload = () => resolve(window.lottie);
    script.onerror = reject;
    document.head.append(script);
  });
  return lottieReady;
}
const known = state => state && !['unknown', 'unavailable'].includes(state.state);
class GardenaMowerCard extends HTMLElement {
  constructor() {
    super(); this.attachShadow({mode:'open'});
    this.shadowRoot.addEventListener('input',event=>{if(event.target.type==='number') event.target.dataset.dirty='true';});
    this.shadowRoot.addEventListener('change',event=>{
      const input=event.target;
      if (!input.dataset.setting || input.type==='number') return;
      this.saveSetting(input.dataset.setting,input.type==='checkbox'?input.checked:input.value);
    });
    // One listener survives every render; never rebind all controls on telemetry.
    this.shadowRoot.addEventListener('click', event => {
      const button = event.composedPath().find(node => node?.tagName === 'BUTTON');
      if (!button || button.disabled) return;
      if (button.dataset.tab) {
        this.tab=button.dataset.tab; this.render(); button.focus();
      } else if (button.dataset.command) this.extraAction(button.dataset.command);
      else if (button.hasAttribute('data-calendar')) this.openCalendar();
      else if (button.dataset.save) this.saveSetting(button.dataset.save);
      else if (button.dataset.action) this.action(button.dataset.action);
      else if (button.dataset.entity) this.moreInfo(button.dataset.entity);
    });
  }
  async saveSetting(id, value) {
    const entity=this._hass.states[id];
    if (this.busy || !known(entity) || !this.watchedEntities.has(id)) return;
    const domain=id.split('.')[0];
    const data={entity_id:id};
    let service;
    if (domain==='switch') { service=value ? 'turn_on' : 'turn_off'; }
    else if (domain==='select') {
      if (!entity.attributes.options?.includes(value)) return;
      service='select_option'; data.option=value;
    } else if (domain==='number') {
      const input=[...this.shadowRoot.querySelectorAll('[data-setting]')].find(el=>el.dataset.setting===id);
      if (!input || !input.reportValidity() || input.value.trim()==='') return;
      const number=Number(input.value), {min,max}=entity.attributes;
      if (!Number.isFinite(number) || (min!=null && number<min) || (max!=null && number>max)) return;
      service='set_value'; data.value=number;
    } else return;
    this.busy=true; this.message=''; this.render();
    try { await this._hass.callService(domain,service,data); this.message='Setting saved'; if(domain==='number') { const input=[...this.shadowRoot.querySelectorAll('[data-setting]')].find(el=>el.dataset.setting===id); if(input) delete input.dataset.dirty; } }
    catch(error) { this.message=`Setting failed: ${error.message || error}`; }
    finally { this.busy=false; this.render(); }
  }
  settingRow(key,label,icon,domain) {
    const entity=this.sensor(key,domain);
    if (!entity) return '';
    const id=escape(entity.entity_id), disabled=this.busy || !known(entity) ? 'disabled' : '';
    const attrs=entity.attributes;
    let control;
    if(domain==='switch') control=`<input type="checkbox" role="switch" data-setting="${id}" aria-label="${escape(label)}" ${entity.state==='on'?'checked':''} ${disabled}>`;
    else if(domain==='select') control=`<select data-setting="${id}" aria-label="${escape(label)}" ${disabled}>${(attrs.options || []).map(option=>`<option value="${escape(option)}" ${option===entity.state?'selected':''}>${escape(option)}</option>`).join('')}</select>`;
    else control=`<div class="number-control"><input type="number" required data-setting="${id}" aria-label="${escape(label)}" value="${known(entity)?escape(entity.state):''}" ${['min','max','step'].filter(k=>attrs[k]!=null).map(k=>`${k}="${escape(attrs[k])}"`).join(' ')} ${disabled}><span>${escape(attrs.unit_of_measurement || '')}</span><button data-save="${id}" ${disabled}>Apply</button></div>`;
    return `<div class="setting-row inline-setting" data-row="${id}"><ha-icon icon="mdi:${icon}"></ha-icon><span class="setting-label">${escape(label)}</span>${control}</div>`;
  }
  spotControl() {
    const entity=this.sensor('spotCutting','switch');
    if (!entity) return '';
    return `<button class="wide-button" data-command="spot" ${this.busy || !known(entity) || !known(this._hass.states[this.config.entity]) ? 'disabled':''}><ha-icon icon="mdi:content-cut"></ha-icon>${entity.state==='on'?'Stop spot cut':'Spot cut'}</button>`;
  }
  connectedCallback() {
    this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.motionListener = () => this.updateIconMotion();
    this.motionPreference.addEventListener('change', this.motionListener);
    if (this.config && this._hass) this.mountStatusIcon();
  }
  disconnectedCallback() {
    this.motionPreference?.removeEventListener('change', this.motionListener);
    this.iconAnimation?.destroy(); this.iconAnimation = undefined;
    this.iconTarget = undefined;
  }
  updateIconMotion() {
    if (!this.iconAnimation) return;
    if (this.config.animation === false || this.motionPreference?.matches) this.iconAnimation.goToAndStop(0, true);
    else this.iconAnimation.play();
  }
  async mountStatusIcon() {
    const target = this.shadowRoot.querySelector('[data-lottie]');
    if (target === this.iconTarget) return;
    this.iconAnimation?.destroy(); this.iconAnimation = undefined;
    this.iconTarget = target;
    if (!target) return;
    try {
      const [lottie, response] = await Promise.all([loadLottie(), fetch(assetURL('home.json'))]);
      if (!response.ok) throw new Error('Icon unavailable');
      const data = await response.json();
      if (target !== this.iconTarget || !this.isConnected) return;
      // Apply a legible teal colour to the original animation's vector strokes.
      const tint = node => {
        if (!node || typeof node !== 'object') return;
        if (['st','fl'].includes(node.ty) && node.c?.a === 0) node.c.k = [0.12,0.67,0.67,1];
        Object.values(node).forEach(value => { if (typeof value === 'object') tint(value); });
      };
      tint(data);
      target.replaceChildren();
      this.iconAnimation = lottie.loadAnimation({container:target,renderer:'svg',loop:true,autoplay:false,animationData:data});
      this.iconAnimation.addEventListener('DOMLoaded', () => this.updateIconMotion());
    } catch (_) { /* Keep the inline home icon when the player cannot load. */ }
  }
  setConfig(config) {
    if (!config.entity?.startsWith('lawn_mower.')) throw new Error('Select a lawn_mower entity');
    this.config = {...config}; this.entityIndex = undefined; this.failedImage = undefined; this.render();
  }
  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (this.frontendRegistry !== hass.entities) {
      this.frontendRegistry = hass.entities;
      if (!this.registry) this.entityIndex = undefined;
    }
    if (!this.registryRequested && hass.callWS) {
      this.registryRequested = true;
      Promise.all([hass.callWS({type:'config/entity_registry/list'}), hass.callWS({type:'config/device_registry/list'}).catch(() => [])]).then(([entries, devices]) => {
        this.registry = Object.fromEntries(entries.map(entry => [entry.entity_id, entry]));
        this.entityIndex = undefined;
        this.devices = Object.fromEntries(devices.map(device => [device.id, device]));
        this.render();
      }).catch(() => { /* Explicit entity overrides remain available. */ });
    }
    this.indexEntities();
    const changed = !this.renderedStates || [...this.watchedEntities].some(id => this.renderedStates.get(id) !== hass.states[id]);
    if (changed || oldHass?.locale !== hass.locale || oldHass?.themes !== hass.themes || oldHass?.language !== hass.language) this.render();
  }
  getCardSize() { return 8; }
  getGridOptions() { return {columns:12, min_columns:6}; }
  static getStubConfig(hass) { return {entity:Object.keys(hass.states).find(id => id.startsWith('lawn_mower.'))}; }
  indexEntities() {
    if (this.entityIndex || !this.config || !this._hass) return;
    this.entityIndex = new Map();
    this.watchedEntities = new Set([this.config.entity, ...Object.values(this.config.entities || {}), this.config.garage_entity].filter(Boolean));
    const registry = this.registry || this._hass.entities || {};
    const device = registry[this.config.entity]?.device_id;
    for (const entry of Object.values(registry)) {
      if (!device || entry.device_id !== device || entry.platform !== 'gardena_mower_ble' || entry.disabled_by) continue;
      this.watchedEntities.add(entry.entity_id);
      const domain = entry.entity_id.split('.')[0];
      const id = entry.unique_id || '';
      // Descriptor unique IDs are address_channel_key; keys may contain underscores.
      const first = id.indexOf('_'), second = id.indexOf('_', first + 1);
      if (first < 0 || second < 0) continue;
      const key = id.slice(second + 1);
      this.entityIndex.set(domain + ':' + key, entry.entity_id);
      if (!this.entityIndex.has(key)) this.entityIndex.set(key, entry.entity_id);
    }
  }
  sensor(key, domain) {
    this.indexEntities();
    const override = this.config.entities?.[domain + ':' + key] || this.config.entities?.[key];
    if (override && (!domain || override.startsWith(domain + '.'))) return this._hass.states[override];
    const id = this.entityIndex?.get(domain ? domain + ':' + key : key);
    return id ? this._hass.states[id] : undefined;
  }
  patchDOM(current, next, preserveScene) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      const replacement=next.cloneNode(true); current.replaceWith(replacement); return replacement;
    }
    if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue=next.nodeValue;
      return current;
    }
    if (current.nodeType === Node.ELEMENT_NODE) {
      if (current.classList.contains('garden-scene')) {
        if (preserveScene) return current;
        const replacement=next.cloneNode(true); current.replaceWith(replacement); return replacement;
      }
      for (const attribute of [...current.attributes]) {
        if (current.tagName === 'DETAILS' && attribute.name === 'open') continue;
        if (attribute.name==='data-dirty') continue;
        if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
      }
      for (const attribute of next.attributes) {
        if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name,attribute.value);
      }
    }
    const key = node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      for (const attr of ['data-tab','data-command','data-action','data-entity','data-page','data-setting','data-save','data-row']) {
        if (node.hasAttribute(attr)) return node.nodeName + ':' + attr + ':' + node.getAttribute(attr);
      }
      return node.nodeName + ':' + (node.classList[0] || '');
    };
    const old = [...current.childNodes];
    const used = new Set();
    let cursor = current.firstChild;
    for (const child of [...next.childNodes]) {
      const wanted = key(child);
      const match = old.find(node => !used.has(node) && key(node) === wanted && node.nodeName === child.nodeName);
      const target = match || child.cloneNode(true);
      if (match) used.add(match);
      if (target !== cursor) current.insertBefore(target,cursor);
      const retained = match ? this.patchDOM(match,child,preserveScene) : target;
      cursor = retained.nextSibling;
    }
    for (const child of old) if (!used.has(child) && child.parentNode === current) child.remove();
    if(current.nodeType===Node.ELEMENT_NODE && current.dataset.setting) {
      if(current.type==='checkbox') current.checked=next.hasAttribute('checked');
      else if(current.tagName==='SELECT' && this.shadowRoot.activeElement!==current) current.value=next.value;
      else if(current.type==='number' && this.shadowRoot.activeElement!==current && !current.dataset.dirty) current.value=next.value;
    }
    return current;
  }
  modelName() {
    if (this.config.model) return this.config.model;
    const model = this.sensor('modelName');
    if (known(model)) return model.state;
    const registry = this.registry || this._hass.entities || {};
    const deviceId = registry[this.config.entity]?.device_id;
    const device = this.devices?.[deviceId] || this._hass.devices?.[deviceId];
    return device?.model_id || device?.model || '';
  }
  sceneState() {
    const mower = this._hass.states[this.config.entity];
    const activity = this.sensor('activity');
    const code = this.sensor('errorCode');
    const state = this.sensor('state');
    if (!known(mower)) return 'unavailable';
    if (mower.state === 'error' || (known(code) && Number(code.state) > 0)) return 'error';
    if (mower.state === 'paused' || state?.state === 'paused') return 'paused';
    if (['off','stopped','wait_for_safetypin'].includes(state?.state)) return 'paused';
    if (mower.state === 'returning' || activity?.state === 'going_home') return 'returning';
    if (activity?.state === 'charging') return 'charging';
    if (this.sensor('spotCutting','sensor')?.state === 'running' && mower.state === 'mowing') return 'spot';
    if (mower.state === 'mowing') return 'mowing';
    if (mower.state === 'docked') return 'parked';
    return 'idle';
  }
  hasGarage() {
    if (typeof this.config.garage === 'boolean') return this.config.garage;
    const setting = this.config.garage_entity ? this._hass.states[this.config.garage_entity] : this.sensor('GarageEnabled');
    return known(setting) && setting.state === 'on';
  }
  sceneImage() {
    const state = this.sceneState();
    // Parked and charging share the same garage/no-garage product photo.
    // Charging adds only the animated bolt overlay.
    if (['parked','charging'].includes(state)) return this.hasGarage()
      ? (this.config.garage_image || assetURL('garage-closed.png'))
      : (this.config.docked_image || assetURL('sileno-minimo-docked-cutout.png'));
    return this.config.top_image || this.config.image || assetURL('sileno-minimo-top-cutout.png');
  }
  statusIcon(state) {
    const kind = {mowing:'cut',spot:'cut',paused:'pause',returning:'home',charging:'bolt',error:'error'}[state];
    if (!kind) return '';
    const custom = this.config.status_icons?.[kind];
    const drawings = {
      error:'<circle class="error-ring" cx="12" cy="12" r="9" pathLength="100"/><path class="error-cross" d="m9 9 6 6m0-6-6 6" pathLength="100"/>',
      cut:'<g class="blade blade-a"><circle cx="7" cy="18" r="3"/><path d="M9 16 19 4"/></g><g class="blade blade-b"><circle cx="17" cy="18" r="3"/><path d="M15 16 5 4"/></g>',
      pause:'<path class="pause-bar" d="M8 5v14M16 5v14"/>',
      home:'<path d="m3 11 9-8 9 8M6 10v11h12V10M10 21v-7h4v7"/>',
      bolt:'<path class="bolt-path" d="m14 2-9 12h7l-2 8 9-12h-7z"/>'
    };
    return `<div class="status-overlay ${kind}" aria-hidden="true">${custom ? `<img src="${escape(custom)}" alt="">` : `<div class="icon-player" ${kind === 'home' ? 'data-lottie="home"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${drawings[kind]}</svg></div>`}</div>`;
  }
  sceneMarkup(photo, modelName) {
    const state = this.sceneState();
    const garage = this.hasGarage();
    const labels = {parked:garage ? 'Parked in garage' : 'Parked at charging station',charging:'Charging',mowing:'Mowing',spot:'Spot cutting',returning:'Returning to dock',paused:'Paused',error:'Mower needs attention',unavailable:'Mower unavailable',idle:'Idle'};
    return `<div class="garden-scene ${state} ${garage ? 'with-garage' : ''} ${this.config.animation === false ? 'no-motion' : ''}" role="img" aria-label="${labels[state]}">
      <div class="mower-anchor"><div class="mower-heading"><div class="rover">${photo ? `<img class="mower-photo" src="${escape(photo)}" alt="" aria-hidden="true">` : '<ha-icon icon="mdi:robot-mower" aria-hidden="true"></ha-icon>'}</div></div></div>
      ${this.statusIcon(state)}<div class="scene-caption">${labels[state]}</div>
    </div>`;
  }
  navigationMarkup() {
    return `<nav class="card-tabs" aria-label="Mower pages">${['overview','schedule','settings','info'].map(tab => `<button data-tab="${tab}" aria-pressed="${(this.tab || 'overview') === tab}" class="${(this.tab || 'overview') === tab ? 'selected' : ''}">${{overview:'Overview',schedule:'Schedule',settings:'Settings',info:'Info'}[tab]}</button>`).join('')}</nav>`;
  }
  entityRow(key, label, icon, domain) {
    const entity = this.sensor(key, domain);
    if (!entity) return '';
    return `<button class="setting-row" data-entity="${escape(entity.entity_id)}"><ha-icon icon="mdi:${icon}"></ha-icon><span>${escape(label)}<strong>${escape(this.formatted(entity))}</strong></span><span class="row-arrow" aria-hidden="true">›</span></button>`;
  }
  parkControls() {
    const park = this.sensor('permanentPark','switch');
    if (!park) return '';
    const disabled = this.busy || !known(park) || !known(this._hass.states[this.config.entity]);
    const held = park.state === 'on';
    return `<div class="park-status">${held ? 'Parked until further notice · scheduled mowing is suspended.' : 'Scheduled operation can be resumed below.'}</div><div class="park-controls"><button class="control" data-command="hold" ${disabled || held ? 'disabled' : ''}><ha-icon icon="mdi:home-lock"></ha-icon>Park until further notice</button><button class="control" data-command="resume" ${disabled ? 'disabled' : ''}><ha-icon icon="mdi:calendar-play"></ha-icon>Resume schedule</button></div>`;
  }
  scheduleMarkup() {
    const calendar = this.sensor('schedule','calendar');
    const tasks = calendar?.attributes.schedules;
    const hold = this.sensor('permanentPark','switch');
    return `<section class="page-panel"><h3>Weekly mower schedule</h3><p class="hint">Stored on the mower. Home Assistant automations may also control mowing independently.</p>${hold?.state === 'on' ? '<div class="notice">Park until further notice is active. Resume the schedule when you want scheduled mowing to continue.</div>' : ''}${!calendar ? '<p>Schedule entity is not available for this mower.</p>' : !known(calendar) ? '<p>The mower schedule is currently unavailable.</p>' : Array.isArray(tasks) && tasks.length ? `<ol class="schedule-list">${tasks.map(task => `<li>${escape(task)}</li>`).join('')}</ol>` : '<p>No weekly mowing times are stored on the mower.</p>'}${this.entityRow('next_start_time','Next start','clock-start')}${calendar ? `<button class="wide-button" data-calendar>Manage in Calendar</button><p class="hint">Choose ${escape(calendar.attributes.friendly_name || 'the mower calendar')} in Home Assistant’s calendar to add, edit or delete weekly mowing entries.</p>` : ''}</section>`;
  }
  settingsMarkup() {
    const basic = [
      ['ManualMowingDuration','Manual mowing duration','timer-play-outline','number'],
      ['EcoMode','ECO mode','leaf','switch'],
      ['SensorControlEnabled','SensorControl','grass','switch'],
      ['SensorControlSensitivity','SensorControl sensitivity','tune','select'],
      ['FrostSensorEnabled','Frost protection','snowflake','switch'],
      ['GarageEnabled','Avoid garage','garage','switch'],
      ['ZoneProtectEnabled','ZoneProtect','shield-outline','switch'],
      ['AntiCollisionRadarEnabled','Anti-collision radar','radar','switch'],
    ].map(args => this.settingRow(...args)).join('');
    const advanced = [['DrivePastWire','Drive past wire','map-marker-distance','number'],['ReversingDistance','Distance from charging station','map-marker-distance','number']].map(args => this.settingRow(...args)).join('');
    const points = Array.from({length:5},(_,i) => i+1).map(i => {
      const enabled = this.sensor(`StartingPoint${i}Enabled`,'switch');
      if (!enabled) return '';
      return `<details class="settings-group"><summary>Starting point ${i}</summary>${this.settingRow(`StartingPoint${i}Enabled`,'Enabled','map-marker-check','switch')}${this.settingRow(`StartingPoint${i}Wire`,'Wire','source-branch','select')}${this.settingRow(`StartingPoint${i}Distance`,'Distance','map-marker-distance','number')}${this.settingRow(`StartingPoint${i}Proportion`,'Mowing share','percent','number')}${this.settingRow(`StartingPoint${i}CorridorCut`,'CorridorCut','arrow-collapse-horizontal','switch')}</details>`;
    }).join('');
    return `<section class="page-panel"><h3>Mower settings</h3><p class="hint">Toggle switches or choose an option here. For numbers, enter a value and press Apply.</p>${basic || '<p>No supported settings are available.</p>'}${advanced ? `<details class="settings-group"><summary>Boundary and station settings</summary>${advanced}</details>` : ''}<h3>Lawn coverage</h3>${this.entityRow('StartingPointChargingStationProportion','Mowing share around the station','percent','sensor')}<p class="hint">Station share is reported by the mower. Adjust the starting-point shares below to change coverage.</p>${points}</section>`;
  }
  infoMarkup() {
    const groups = [
      ['Status & safety', [['state','Mower state','state-machine'],['mode','Operating mode','cog-clockwise'],['errorDescription','Current error','alert-circle-outline'],['collision','Collision','shield-alert','binary_sensor'],['lift','Lift detected','arrow-up','binary_sensor'],['loopSignalStrength','Loop signal','signal']]],
      ['Battery & charging', [['battery_level','Battery level','battery'],['RemainingChargingTime','Charging remaining','battery-clock'],['batteryTemperature','Temperature','thermometer'],['batteryVoltage','Voltage','flash'],['batteryCurrent','Current','current-dc'],['numberOfChargingCycles','Charging cycles','battery-sync']]],
      ['Usage & maintenance', [['cuttingBladeUsageTime','Blade usage','content-cut'],['totalCuttingTime','Total mowing','timer-outline'],['totalRunningTime','Total running','timer-outline'],['totalChargingTime','Total charging','battery-clock'],['totalSearchingTime','Total searching','home-search'],['numberOfCollisions','Total collisions','counter']]],
      ['Device', [['modelName','Model','robot-mower'],['serialNumber','Serial number','identifier'],['softwarePackageVersion','Firmware','chip'],['hardwareRevision','Hardware revision','chip']]],
      ['History', [['last_message','Last recorded message','message-text-outline']]],
    ];
    const fields=groups.map(([title,rows])=>{
      const content=rows.map(args=>this.entityRow(...args)).join('');
      return content?`<section class="info-group"><h4>${title}</h4>${content}</section>`:'';
    }).join('');
    const refresh = this.sensor('diagnostic_refresh','button');
    return `<section class="page-panel"><h3>Mower information</h3>${fields || '<p>No information entities are available.</p>'}<p class="hint">Last recorded message is historical and may not describe the current state.</p>${refresh ? `<button class="wide-button" data-command="refresh" ${this.busy || refresh.state === 'unavailable' ? 'disabled' : ''}>Refresh diagnostics</button>` : ''}<p class="credits"><a href="https://lordicon.com/" target="_blank" rel="noopener noreferrer">Home animation by Lordicon</a> · Card ${VERSION}</p></section>`;
  }
  async extraAction(action) {
    const specs = {spot:['spotCutting','switch',this.sensor('spotCutting','switch')?.state==='on'?'turn_off':'turn_on','Spot-cut command sent'],hold:['permanentPark','switch','turn_on','Park-until-further-notice command sent'],resume:['permanentPark','switch','turn_off','Resume-schedule command sent'],refresh:['diagnostic_refresh','button','press','Diagnostics refreshed']};
    const spec = specs[action];
    if (!spec || this.busy) return;
    const [key,domain,service,message] = spec;
    const entity = this.sensor(key,domain);
    if (!entity || entity.state === 'unavailable' || (domain === 'switch' && !known(entity)) || (domain === 'switch' && !known(this._hass.states[this.config.entity]))) return;
    this.busy = true; this.message = ''; this.render();
    try { await this._hass.callService(domain,service,{entity_id:entity.entity_id});this.message=message; }
    catch (error) { this.message=`Command failed: ${error.message || error}`; }
    finally { this.busy=false;this.render(); }
  }
  openCalendar() {
    history.pushState(null,'','/calendar');
    window.dispatchEvent(new CustomEvent('location-changed',{detail:{replace:false}}));
  }
  formatted(state) {
    if (!known(state)) return '—';
    if (this._hass.formatEntityState) return this._hass.formatEntityState(state);
    return `${state.state.replaceAll('_',' ')} ${state.attributes.unit_of_measurement || ''}`.trim();
  }
  moreInfo(entity) { this.dispatchEvent(new CustomEvent('hass-more-info', {detail:{entityId:entity}, bubbles:true, composed:true})); }
  async action(service) {
    const mower = this._hass.states[this.config.entity];
    const bit = {start_mowing:2,pause:1,dock:4}[service];
    if (this.busy || !known(mower) || !(mower.attributes.supported_features & bit)) return;
    this.busy = true; this.message = ''; this.render();
    try { await this._hass.callService('lawn_mower', service, {entity_id:this.config.entity}); this.message = 'Command sent'; }
    catch (error) { this.message = `Command failed: ${error.message || error}`; }
    finally { this.busy = false; this.render(); }
  }
  render() {
    if (!this._hass || !this.config) return;
    const mower = this._hass.states[this.config.entity];
    const battery = this.sensor('battery_level');
    const activity = this.sensor('activity');
    const error = this.sensor('errorDescription');
    const code = this.sensor('errorCode');
    const hasError = known(code) && Number(code.state) !== 0;
    const level = known(battery) && Number.isFinite(Number(battery.state)) ? Math.max(0,Math.min(100,Number(battery.state))) : null;
    const status = known(mower) ? this.formatted(known(activity) ? activity : mower) : 'Unavailable';
    const modelName = this.modelName();
    const selectedImage = this.sceneImage();
    const photo = selectedImage !== this.failedImage ? selectedImage : '';

    const tile = (key,label,icon) => { const state = this.sensor(key); return `<button class="tile" data-entity="${escape(state?.entity_id || '')}" ${state ? '' : 'disabled'}><ha-icon icon="mdi:${icon}"></ha-icon><span>${label}<strong>${escape(this.formatted(state))}</strong></span></button>`; };
    const controls = [['start_mowing','Start','play',2],['pause','Pause','pause',1],['dock','Park','home-import-outline',4]].map(([service,label,icon,bit]) => `<button class="control ${service === 'start_mowing' ? 'primary' : ''}" data-action="${service}" ${this.busy || !known(mower) || !(mower.attributes.supported_features & bit) ? 'disabled' : ''}><ha-icon icon="mdi:${icon}"></ha-icon>${label}</button>`).join('');
    const sceneKey = JSON.stringify([photo, modelName, this.sceneState(), this.hasGarage(), this.config.animation, this.config.status_icons]);
    const markup = `<link rel="stylesheet" href="${SCENE_CSS}"><style>
      :host{display:block}ha-card{display:block;overflow:hidden;color:var(--primary-text-color);background:var(--ha-card-background,var(--card-background-color));border-radius:24px;padding:22px;font-family:inherit}header{display:flex;justify-content:space-between;align-items:center;gap:12px}.eyebrow{font-size:10px;letter-spacing:2px;color:var(--secondary-text-color);font-weight:700}h2{font-size:22px;margin:5px 0;font-weight:600}.badge{font-size:12px;border-radius:20px;padding:8px 12px;background:var(--secondary-background-color);text-transform:capitalize}.model-name{font-size:11px;color:var(--secondary-text-color);margin-top:4px}.battery-label{display:flex;justify-content:space-between;font-size:13px;margin-bottom:9px}.track{height:6px;background:var(--divider-color);border-radius:4px;overflow:hidden}.fill{height:100%;background:${level !== null && level < 20 ? '#e49c36' : '#79ad51'};width:${level ?? 0}%;transition:width .4s}.tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0}button{font:inherit;color:inherit;cursor:pointer;border:0}button:focus-visible,summary:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}button:disabled{cursor:default;opacity:.45}.tile{display:flex;align-items:center;text-align:left;gap:10px;border-radius:14px;padding:13px;background:var(--secondary-background-color);min-width:0}.tile span{font-size:11px;color:var(--secondary-text-color);min-width:0}.tile strong{display:block;font-size:13px;font-weight:500;color:var(--primary-text-color);margin-top:4px;overflow-wrap:anywhere}.tile ha-icon{--mdc-icon-size:21px;color:#79ad51;flex-shrink:0}.controls{display:flex;gap:8px}.control{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:12px 4px;border-radius:13px;background:var(--secondary-background-color)}.primary{background:#e66f26;color:white}.control ha-icon{--mdc-icon-size:20px}.alert{padding:12px;border-radius:12px;background:#e66f261c;margin:14px 0;font-size:13px}.message{font-size:12px;color:var(--secondary-text-color);margin-top:12px}summary{cursor:pointer;font-size:12px;color:var(--secondary-text-color);padding-top:18px}.details{margin-bottom:0}.info{background:none;padding:0;text-align:left} @media(max-width:340px){ha-card{padding:16px}.control{font-size:12px}.tile{padding:10px}}
    </style><ha-card><header><button class="info" data-entity="${escape(this.config.entity)}"><div class="eyebrow">GARDENA · MOWER</div><h2>${escape(this.config.name || mower?.attributes.friendly_name || 'Garden mower')}</h2>${modelName ? `<div class="model-name">${escape(modelName)}</div>` : ''}</button><span class="badge">${escape(status)}</span></header>${this.sceneMarkup(photo, modelName)}${this.navigationMarkup()}<section data-page="overview" ${!this.tab || this.tab === 'overview' ? '' : 'hidden'}><div class="battery-label"><span>Battery</span><strong>${level === null ? '—' : `${level}%`}</strong></div><div class="track" role="meter" aria-label="Battery" ${level === null ? 'aria-valuetext="Unknown"' : `aria-valuenow="${level}"`} aria-valuemin="0" aria-valuemax="100"><div class="fill"></div></div><div class="tiles">${tile('next_start_time','Next start','clock-start')}${tile('cuttingBladeUsageTime','Blade usage','content-cut')}</div>${hasError ? `<div class="alert" role="alert">${escape(known(error) ? error.state : `Mower error ${code.state}`)}${error?.attributes.guidance ? `<br>${escape(typeof error.attributes.guidance === 'string' ? error.attributes.guidance : JSON.stringify(error.attributes.guidance))}` : ''}</div>` : ''}<div class="controls">${controls}</div>${this.spotControl()}${this.parkControls()}<div class="message" role="status">${escape(this.busy ? 'Sending command…' : this.message || '')}</div></section><section data-page="schedule" ${this.tab === 'schedule' ? '' : 'hidden'}>${this.scheduleMarkup()}</section><section data-page="settings" ${this.tab === 'settings' ? '' : 'hidden'}>${this.settingsMarkup()}</section><section data-page="info" ${this.tab === 'info' ? '' : 'hidden'}>${this.infoMarkup()}</section><div class="message page-message" role="status">${this.tab && this.tab !== 'overview' ? escape(this.busy ? 'Sending command…' : this.message || '') : ''}</div></ha-card>`;
    if (!this.shadowRoot.querySelector('ha-card')) this.shadowRoot.innerHTML = markup;
    else {
      const template = document.createElement('template'); template.innerHTML = markup;
      this.patchDOM(this.shadowRoot,template.content,this.sceneKey === sceneKey);
    }
    this.shadowRoot.querySelector('.garden-scene').hidden = !!this.tab && this.tab !== 'overview';
    this.sceneKey = sceneKey;
    this.mountStatusIcon();
    const image = this.shadowRoot.querySelector('.mower-photo');
    if (image) image.onerror = () => { this.failedImage = photo; this.render(); };
    this.indexEntities();
    this.renderedStates = new Map([...this.watchedEntities].map(id => [id,this._hass.states[id]]));

  }
}
if (!customElements.get('gardena-mower-card')) customElements.define('gardena-mower-card', GardenaMowerCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === 'gardena-mower-card')) window.customCards.push({type:'gardena-mower-card',name:'Gardena Mower',description:'Mower overview, battery, controls and maintenance.',preview:true});
})();
