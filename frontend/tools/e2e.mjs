// End-to-end run of the production build in headless Chrome (hardware WebGL): opens every scene
// from the picker, checks that each layer draws, orbits, zooms, toggles the overlays, measures,
// walks the capture path, reads the metrics sheet and follows ?scene= links. Screenshots go to
// .e2e-results/. With THUMBS=1 it also writes the picker thumbnails (public/scenes/<id>/thumb.jpg)
// from the default view of each scene. Exit code 1 when any check fails.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { openChrome, watchConsole } from './devtools.mjs';

const DIST = 'dist/v1/browser';
const OUT = resolve(process.env.E2E_DIR ?? '.e2e-results');
const PORT = Number(process.env.E2E_PORT ?? 4393);
const THUMBS = process.env.THUMBS === '1';
const WIDTH = 1280;
const HEIGHT = 800;

if (!existsSync(join(DIST, 'index.html')) || process.env.E2E_BUILD)
    execSync('npx ng build', { stdio: 'inherit' });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const types = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.jpg': 'image/jpeg',
};
const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
    const file =
        path && existsSync(join(DIST, path)) && statSync(join(DIST, path)).isFile()
            ? path
            : 'index.html';
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(join(DIST, file)));
}).listen(PORT);

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const results = [];
function check(name, pass, detail) {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const chrome = await openChrome({ name: 'e2e', port: 9446, windowSize: `${WIDTH},${HEIGHT}` });
const { call, evaluate, socket } = chrome;
const page = watchConsole(socket);

async function until(expression, timeoutMs, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await evaluate(expression);
        if (value) return value;
        await wait(intervalMs);
    }
    return null;
}

const click = (selector) =>
    evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`,
    );
const text = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent?.trim() ?? null`);
const frames = (n = 3) =>
    evaluate(
        `new Promise((done) => { let k = ${n}; const step = () => (--k ? requestAnimationFrame(step) : done(true)); requestAnimationFrame(step); })`,
    );

async function screenshot(name, format = 'png') {
    const { data } = await call('Page.captureScreenshot', { format, quality: 85 });
    if (name) writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    return data;
}

/**
 * Share of the viewport that the WebGL view painted (pixels away from the background colour),
 * measured on a screenshot decoded in the page with the HUD hidden.
 */
async function coverage() {
    await evaluate(
        `document.querySelectorAll('.hud, .rail, .dock, .label, .hint').forEach((el) => (el.style.visibility = 'hidden'))`,
    );
    await frames();
    const data = await screenshot(null);
    await evaluate(
        `document.querySelectorAll('.hud, .rail, .dock, .label, .hint').forEach((el) => (el.style.visibility = ''))`,
    );
    return evaluate(`new Promise((done) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
            let painted = 0;
            for (let i = 0; i < pixels.length; i += 4) {
                const d = Math.abs(pixels[i] - 27) + Math.abs(pixels[i + 1] - 18) + Math.abs(pixels[i + 2] - 53);
                if (d > 40) painted++;
            }
            done(painted / (pixels.length / 4));
        };
        image.src = 'data:image/png;base64,${data}';
    })`);
}

async function drag(x0, y0, dx, dy, steps = 12) {
    await call('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: x0,
        y: y0,
        button: 'left',
        buttons: 1,
        clickCount: 1,
    });
    for (let i = 1; i <= steps; i++) {
        await call('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: x0 + (dx * i) / steps,
            y: y0 + (dy * i) / steps,
            button: 'left',
            buttons: 1,
        });
    }
    await call('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: x0 + dx,
        y: y0 + dy,
        button: 'left',
        buttons: 0,
        clickCount: 1,
    });
}

async function tap(x, y) {
    for (const type of ['mousePressed', 'mouseReleased']) {
        await call('Input.dispatchMouseEvent', {
            type,
            x,
            y,
            button: 'left',
            buttons: type === 'mousePressed' ? 1 : 0,
            clickCount: 1,
        });
    }
}

const differs = async (before) => (await screenshot(null)) !== before;

async function openFromPicker(id) {
    await evaluate(
        `document.querySelector('app-room-viewer') ? (document.querySelector('.hud .back').click(), true) : true`,
    );
    await until(`!!document.querySelector('app-scene-picker .card')`, 10_000);
    const cards = await evaluate(
        `[...document.querySelectorAll('app-scene-picker .card .badge')].map((b) => b.textContent.trim())`,
    );
    const index = cards.indexOf(id);
    await evaluate(`document.querySelectorAll('app-scene-picker .card')[${index}].click()`);
    const opened = await until(
        `!!document.querySelector('app-room-viewer') && !document.querySelector('app-busy-veil.visible')`,
        60_000,
    );
    await frames(5);
    return !!opened;
}

try {
    await call('Emulation.setDeviceMetricsOverride', {
        width: WIDTH,
        height: HEIGHT,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await call('Page.navigate', { url: `http://localhost:${PORT}/` });
    const cards = await until(`document.querySelectorAll('app-scene-picker .card').length`, 15_000);
    check('picker lists the three scenes', cards === 3, `${cards} cards`);
    await wait(500);
    await screenshot('01-picker.png');

    const expected = Object.fromEntries(
        ['A', 'B', 'C'].map((id) => [
            id,
            JSON.parse(readFileSync(join(DIST, 'scenes', id, 'scene.json'), 'utf8')),
        ]),
    );

    for (const id of ['A', 'B', 'C']) {
        const scene = expected[id];
        const opened = await openFromPicker(id);
        const title = await text('app-room-viewer .chip.title');
        check(
            `${id}: opens from the picker`,
            opened && title?.includes(scene.name),
            title ?? 'no viewer',
        );
        const url = await evaluate('location.search');
        check(`${id}: URL follows the scene`, url === `?scene=${id}`, url);

        if (THUMBS) {
            await click('app-room-viewer .rail .cameras');
            await click('app-room-viewer .rail .path');
            await evaluate(
                `document.querySelectorAll('.hud, .rail, .dock').forEach((el) => (el.style.visibility = 'hidden'))`,
            );
            await frames();
            const { data } = await call('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
            writeFileSync(join('public', 'scenes', id, 'thumb.jpg'), Buffer.from(data, 'base64'));
            await evaluate(
                `document.querySelectorAll('.hud, .rail, .dock').forEach((el) => (el.style.visibility = ''))`,
            );
            await click('app-room-viewer .rail .cameras');
            await click('app-room-viewer .rail .path');
        }

        const layers = scene.layers.mesh ? ['mesh', 'dense', 'sparse'] : ['dense', 'sparse'];
        const defaultLayer = await text('app-room-viewer .segmented button.on');
        check(
            `${id}: default layer is the best one`,
            defaultLayer?.toLowerCase() === layers[0],
            defaultLayer ?? '-',
        );
        for (const layer of layers) {
            await evaluate(
                `[...document.querySelectorAll('app-room-viewer .segmented button')].find((b) => b.textContent.trim().toLowerCase() === '${layer}').click()`,
            );
            await frames();
            const painted = await coverage();
            const summary = await text('app-room-viewer .chip.summary');
            const count =
                layer === 'mesh' ? scene.layers.mesh.triangles : scene.layers[layer].count;
            check(
                `${id}: ${layer} layer draws`,
                painted > (layer === 'sparse' ? 0.01 : 0.04),
                `${(painted * 100).toFixed(1)}% of the view · ${summary}`,
            );
            check(
                `${id}: ${layer} count in the HUD`,
                summary?.includes(layer === 'mesh' ? 'triangles' : `${layer} points`) && count > 0,
                `${count} in scene.json`,
            );
            await screenshot(`${id}-${layer}.png`);
        }
        await evaluate(
            `[...document.querySelectorAll('app-room-viewer .segmented button')].find((b) => b.textContent.trim().toLowerCase() === '${layers[0]}').click()`,
        );
        await frames();

        let before = await screenshot(null);
        await drag(WIDTH / 2, HEIGHT / 2, 180, 40);
        await frames();
        check(`${id}: dragging orbits the view`, await differs(before), 'view changed');
        before = await screenshot(null);
        await call('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: WIDTH / 2,
            y: HEIGHT / 2,
            deltaX: 0,
            deltaY: -400,
        });
        await frames();
        check(`${id}: the wheel zooms`, await differs(before), 'view changed');
        await evaluate(
            `document.querySelector('app-room-viewer canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
        );
        await frames();

        before = await screenshot(null);
        await click('app-room-viewer .rail .cutaway');
        await frames();
        const cutawayOff = await differs(before);
        await click('app-room-viewer .rail .cutaway');
        await frames();
        check(
            `${id}: the cutaway changes what is visible`,
            cutawayOff,
            'view changed with the cutaway off',
        );

        await click('app-room-viewer .rail .box');
        await frames();
        const labels = await evaluate(
            `[...document.querySelectorAll('app-room-viewer .label')].map((l) => l.textContent.trim())`,
        );
        const wantX = scene.room.extentX.modelCm.toFixed(1);
        const wantZ = scene.room.extentZ.modelCm.toFixed(1);
        check(
            `${id}: room box shows the measured extents with the tape values`,
            labels.length === 2 &&
                labels.some((l) => l.startsWith(wantX)) &&
                labels.some((l) => l.startsWith(wantZ)) &&
                labels.every((l) => l.includes('tape')),
            labels.join(' | '),
        );
        await screenshot(`${id}-box.png`);
        await click('app-room-viewer .rail .box');

        await click('app-room-viewer .dock .measure');
        await frames();
        // a grid of taps over the middle of the view; misses on empty space are not counted
        const spots = [];
        for (let gy = 0; gy < 6; gy++) {
            for (let gx = 0; gx < 9; gx++) spots.push([0.25 + gx * 0.0625, 0.3 + gy * 0.08]);
        }
        for (const [fx, fy] of spots) {
            await tap(WIDTH * fx, HEIGHT * fy);
            await frames(2);
            if ((await evaluate(`document.querySelectorAll('app-room-viewer .label').length`)) > 0)
                break;
        }
        const measured = await text('app-room-viewer .label');
        const cm = measured ? parseFloat(measured) : NaN;
        const diagonalCm = Math.hypot(...scene.room.max.map((v, a) => v - scene.room.min[a])) * 100;
        check(
            `${id}: measuring two points gives a distance inside the room`,
            cm > 0 && cm < diagonalCm * 1.2,
            measured ?? 'no measurement',
        );
        await screenshot(`${id}-measure.png`);
        await click('app-room-viewer .dock .measure');

        before = await screenshot(null);
        await click('app-room-viewer .dock .tour');
        await wait(1500);
        const walking = await evaluate(
            `document.querySelector('app-room-viewer .dock .tour').classList.contains('on')`,
        );
        check(
            `${id}: the walk moves along the capture path`,
            walking && (await differs(before)),
            walking ? 'camera moving' : 'not walking',
        );
        await screenshot(`${id}-walk.png`);
        await click('app-room-viewer .dock .tour');

        await click('app-room-viewer .hud .info');
        await until(`!!document.querySelector('app-info-sheet dl')`, 3000);
        const rows = await evaluate(
            `Object.fromEntries([...document.querySelectorAll('app-info-sheet dl div')].map((d) => [d.querySelector('dt').textContent.trim(), d.querySelector('dd').textContent.trim()]))`,
        );
        const registered = rows['cameras registered'];
        check(
            `${id}: metrics sheet matches scene.json`,
            registered === `${scene.metrics.registered} / ${scene.metrics.frames}`,
            `${registered} · ${rows['reprojection mean / median']}`,
        );
        await screenshot(`${id}-info.png`);
        await click('app-info-sheet .round-action.close');
    }

    await call('Page.navigate', { url: `http://localhost:${PORT}/?scene=B` });
    const deep = await until(
        `document.querySelector('app-room-viewer .chip.title')?.textContent.includes('Sala 90')`,
        30_000,
    );
    check('?scene=B opens scene B directly', !!deep, deep ? 'B open' : 'not opened');
    await click('app-room-viewer .hud .back');
    const backHome = await until(
        `!!document.querySelector('app-scene-picker') && location.search === ''`,
        5000,
    );
    check('back returns to the picker', !!backHome, await evaluate('location.href'));

    await call('Emulation.setDeviceMetricsOverride', {
        width: 412,
        height: 915,
        deviceScaleFactor: 2,
        mobile: true,
    });
    await call('Page.navigate', { url: `http://localhost:${PORT}/?scene=C` });
    await until(
        `!!document.querySelector('app-room-viewer') && !document.querySelector('app-busy-veil.visible')`,
        30_000,
    );
    await frames(5);
    const overlap = await evaluate(`(() => {
        const boxes = [...document.querySelectorAll('app-room-viewer .dock > *, app-room-viewer .rail > *')].map((el) => el.getBoundingClientRect());
        return boxes.some((a, i) => boxes.some((b, j) => i < j && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom))
            || boxes.some((b) => b.left < 0 || b.right > innerWidth);
    })()`);
    check('phone layout: controls fit without overlapping', !overlap, overlap ? 'overlap' : 'ok');
    await screenshot('02-phone.png');

    check(
        'no console errors',
        page.errors.length === 0,
        page.errors.slice(0, 3).join(' | ') || 'none',
    );
} catch (error) {
    check('e2e run', false, error.stack ?? String(error));
} finally {
    chrome.close();
    server.close();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
