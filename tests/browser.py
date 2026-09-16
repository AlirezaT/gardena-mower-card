"""Exercise exactly the flat files downloaded by HACS; all mower calls are fake."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import tempfile
import shutil
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with tempfile.TemporaryDirectory() as temp:
    target = Path(temp)
    for asset in (ROOT / 'dist').iterdir():
        shutil.copy(asset, target / asset.name)
    preview = (ROOT / 'tests/preview.html').read_text().replace('../dist/gardena-mower-card.js', './gardena-mower-card.js')
    (target / 'index.html').write_text(preview)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=temp))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=['--no-sandbox'])
            page = browser.new_page(viewport={'width':390,'height':1100})
            errors, bad_responses, requests = [], [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('response', lambda response: bad_responses.append(response.url) if response.status >= 400 else None)
            page.on('request', lambda request: requests.append(request.url))
            page.goto(origin, wait_until='networkidle')
            for state in ['parked','charging','mowing','spot','returning','paused','error','unavailable']:
                page.select_option('#activity', state)
                page.wait_for_function('''()=>{const image=card.shadowRoot.querySelector('.mower-photo');return image && image.complete && image.naturalWidth>0}''')
                assert page.locator('.garden-scene').get_attribute('class').split()[1] == state
                if state == 'returning':
                    page.wait_for_function('card.iconAnimation && card.iconAnimation.isLoaded')
            page.select_option('#activity', 'parked')
            page.locator('#garage').uncheck()
            assert 'docked-cutout' in page.locator('.mower-photo').get_attribute('src')
            page.locator('#garage').check()
            assert 'garage-closed' in page.locator('.mower-photo').get_attribute('src')
            page.locator('#motion').uncheck()
            assert 'no-motion' in page.locator('.garden-scene').get_attribute('class')
            page.evaluate('''()=>{
              window.calls=[];
              card._hass.callService=async(domain,service,data)=>{
                calls.push([domain,service,data]);
                const entity=card._hass.states[data.entity_id];
                const state=domain==='switch'?(service==='turn_on'?'on':'off'):String(data.option ?? data.value ?? entity.state);
                card._hass.states={...card._hass.states,[data.entity_id]:{...entity,state}};
              };
            }''')
            page.locator('[data-command="spot"]').click()
            assert page.evaluate('calls.at(-1)[1]') == 'turn_on'
            assert page.locator('[data-command="spot"]').inner_text() == 'Stop spot cut'
            page.locator('[data-command="spot"]').click()
            assert page.evaluate('calls.at(-1)[1]') == 'turn_off'
            page.locator('[data-tab="settings"]').click()
            assert 'Mowing share around the station' in page.locator('[data-page="settings"]').inner_text()
            page.locator('[data-setting="switch.demo_ecomode"]').click()
            assert page.evaluate('calls.at(-1)[1]') == 'turn_on'
            page.locator('[data-setting="select.demo_sensorcontrolsensitivity"]').select_option('High')
            assert page.evaluate('calls.at(-1)[2].option') == 'High'
            number=page.locator('[data-setting="number.demo_manualmowingduration"]')
            number.fill('4.5')
            page.evaluate("()=>{card.hass={...card._hass,states:{...card._hass.states,'sensor.battery':{state:'85',attributes:{}}}}}")
            assert number.input_value()=='4.5'
            page.locator('[data-save="number.demo_manualmowingduration"]').click()
            assert page.evaluate('calls.at(-1)[2].value')==4.5
            count=page.evaluate('calls.length');number.fill('99');page.locator('[data-save="number.demo_manualmowingduration"]').click()
            assert page.evaluate('calls.length')==count
            page.locator('[data-tab="info"]').click()
            assert page.locator('.info-group').count()==5
            page.locator('[data-tab="overview"]').click()
            # Preserve clicks/focus when telemetry arrives between pointer down/up.
            for relevant in [False,True]:
                button=page.locator('[data-tab="settings"]');rect=button.bounding_box()
                page.mouse.move(rect['x']+rect['width']/2,rect['y']+rect['height']/2);page.mouse.down()
                page.evaluate('''relevant=>{const id=relevant?'sensor.battery':'sensor.other';card.hass={...card._hass,states:{...card._hass.states,[id]:{state:'83',attributes:{}}}}}''',relevant)
                page.mouse.up();assert page.evaluate('card.tab')=='settings'
                page.locator('[data-tab="overview"]').click()
            page.evaluate('''()=>{window.renders=0;const render=card.render.bind(card);card.render=()=>{renders++;render()};for(let i=0;i<100;i++)card.hass={...card._hass,states:{...card._hass.states,'sensor.other':{state:String(i),attributes:{}}}}}''')
            assert page.evaluate('renders')==0
            for tab in ['overview','settings','info','schedule']:
                page.locator(f'[data-tab="{tab}"]').click()
                assert page.evaluate("()=>{const c=card.shadowRoot.querySelector('ha-card');return c.scrollWidth<=c.clientWidth}")
            # The demo is synthetic; screenshots contain no device/user information.
            page.locator('[data-tab="overview"]').click()
            page.locator('gardena-mower-card').screenshot(path=str(target/'overview.png'))
            # Parked activity can persist through the entire recharge (observed on Minimo).
            def charging_case(mower='docked', activity='parked', remaining='54.4', expected='charging', garage=True, state='restricted', error='0'):
                page.evaluate("""c=>{
                  card.setConfig({entity:'lawn_mower.test',garage:c.garage,entities:{activity:'sensor.activity',state:'sensor.state',RemainingChargingTime:'sensor.remaining',errorCode:'sensor.error'}});
                  card.hass={states:{'lawn_mower.test':{state:c.mower,attributes:{supported_features:7}},'sensor.activity':{state:c.activity,attributes:{}},'sensor.state':{state:c.state,attributes:{}},'sensor.remaining':{state:c.remaining,attributes:{unit_of_measurement:'min'}},'sensor.error':{state:c.error,attributes:{}}},callService:async()=>{throw new Error('No device commands')}};
                }""",locals())
                assert page.evaluate('card.sceneState()')==expected
                assert page.locator('.status-overlay.bolt').count()==(1 if expected=='charging' else 0)
                if expected=='charging':
                    assert page.locator('.badge').inner_text()=='Charging'
            charging_case()
            garage_photo=page.locator('.mower-photo').get_attribute('src')
            charging_case(remaining='0.0',expected='parked')
            assert page.locator('.mower-photo').get_attribute('src')==garage_photo
            charging_case(garage=False)
            dock_photo=page.locator('.mower-photo').get_attribute('src')
            charging_case(garage=False,remaining='0',expected='parked')
            assert page.locator('.mower-photo').get_attribute('src')==dock_photo
            for value in ['unavailable','unknown','','NaN','-1','0']:
                charging_case(remaining=value,expected='parked')
            charging_case(activity='charging',remaining='unknown')
            for mower in ['mowing','returning','paused','error','unavailable']:
                charging_case(mower=mower,expected=mower)
            charging_case(state='paused',expected='paused')
            charging_case(error='15',expected='error')
            # Registry discovery must distinguish the spot switch from its sensor.
            page.evaluate('''()=>{
              const states={'lawn_mower.test':{state:'mowing',attributes:{supported_features:7}},'sensor.spot':{state:'running',attributes:{}},'switch.spot':{state:'on',attributes:{}}};
              card.registry={'lawn_mower.test':{entity_id:'lawn_mower.test',device_id:'demo',platform:'gardena_mower_ble',unique_id:'demo_1_mower'},'switch.spot':{entity_id:'switch.spot',device_id:'demo',platform:'gardena_mower_ble',unique_id:'demo_1_spotCutting'},'sensor.spot':{entity_id:'sensor.spot',device_id:'demo',platform:'gardena_mower_ble',unique_id:'demo_1_spotCutting'}};
              card.setConfig({entity:'lawn_mower.test'});card.hass={states,callService:async()=>{throw new Error('offline')}};
            }''')
            assert 'spot' in page.locator('.garden-scene').get_attribute('class')
            page.locator('[data-command="spot"]').click()
            assert 'Command failed: offline' in page.locator('[data-page="overview"] [role="status"]').inner_text()
            page.evaluate("()=>{card.hass={...card._hass,states:{...card._hass.states,'lawn_mower.test':{state:'unavailable',attributes:{supported_features:7}}}}}")
            assert page.locator('[data-command="spot"]').is_disabled()
            assert not errors,errors
            assert not bad_responses,bad_responses
            assert all(url.startswith(origin) or url.startswith('data:') for url in requests),requests
            browser.close()
            print('PASS: release assets, eight states, settings, spot cut, discovery, errors, mobile layout and telemetry clicks; all services mocked.')
    finally:
        server.shutdown()
