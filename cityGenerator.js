/**
 * Procedural city. Independent Voronoi neighborhoods are joined by streets; cars navigate the resulting connected graph.
 */
import * as THREE from 'three';
import { buildStreetGraph, createTrafficAgent, advanceTraffic } from './traffic.mjs';
import { districtTypes } from './districts.mjs';
import { createNeighborhoods } from './neighborhoods.mjs';
import { inset, makePath, samplePath } from './voronoi.mjs';
import { OrbitControls } from '../../Lib/Three/OrbitControls.js';

const view = document.getElementById('city-view');
const palette = getComputedStyle(document.documentElement);
/**
 * Read a shared CSS palette entry as a Three.js color.
 *
 * @param name - CSS custom-property name or display label used by this operation.
 * @returns Three.js color created from the named shared CSS palette entry.
 */
const color = (name) => new THREE.Color(palette.getPropertyValue(name).trim());
const scene = new THREE.Scene();
scene.background = color('--site-bg');
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
camera.position.set(100, 95, 100);
let renderer;
try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
    const message = document.getElementById('scene-error');
    message.hidden = false;
    message.textContent = 'Unable to display the city. Please enable WebGL in your browser.';
    throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.domElement.setAttribute('aria-label', 'Generated city. Drag to orbit and scroll to zoom.');
view.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 15;
controls.maxDistance = 400;
scene.add(new THREE.HemisphereLight(0xffffff, 0x263348, 2));
const sun = new THREE.DirectionalLight(0xffffff, 2.5);
sun.position.set(50, 100, 30);
scene.add(sun);
const city = new THREE.Group();
scene.add(city);
const box = new THREE.BoxGeometry(1, 1, 1);
const districtMaterials = districtTypes.map(d => new THREE.MeshStandardMaterial({color: d.color, roughness: .75}));
const districtGround = districtTypes.map(d => new THREE.MeshStandardMaterial({color: new THREE.Color(d.color).multiplyScalar(.45)}));
const connectionMaterial = new THREE.MeshBasicMaterial({color: 0xffdf7c});
const legend = document.getElementById('district-legend');
districtTypes.forEach(d => {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'district-swatch';
    swatch.style.backgroundColor = d.color;
    item.append(swatch, document.createTextNode(d.name));
    legend.appendChild(item);
});
const parks = new THREE.MeshStandardMaterial({ color: 0x386b53 });
const roads = new THREE.MeshStandardMaterial({ color: color('--site-bg') });
const paint = new THREE.MeshStandardMaterial({ color: 0xeeeecc });
const windows = new THREE.MeshStandardMaterial({ color: 0x203647 });
const tires = new THREE.MeshStandardMaterial({ color: 0x111820 });
const carColors = [0xe6ab52, 0xdc6262, 0x629ad9, 0xe6edf5].map(value => new THREE.MeshStandardMaterial({ color: value }));
const peopleColors = [0xf0bc88, 0xa479cf, 0xe68c62].map(value => new THREE.MeshStandardMaterial({ color: value }));
const headGeometry = new THREE.SphereGeometry(0.09, 6, 4);
let movers = [];
let streetGraph;
let elapsed = 0;
/**
 * Reuse unit-box geometry to create a positioned, scaled scene part.
 *
 * @param parent - Three.js object or group receiving the created part.
 * @param material - Shared Three.js material assigned to the created mesh.
 * @param x - X coordinate in the operation's local coordinate system.
 * @param y - Y coordinate in the operation's local coordinate system.
 * @param z - Z coordinate in the operation's local coordinate system.
 * @param width - Horizontal extent of the created scene part in world units.
 * @param height - Extrusion or mesh height in world units.
 * @param depth - Front-to-back size of the box part in world units.
 * @returns Mesh created from shared box geometry and attached to its parent.
 */
function part(parent, material, x, y, z, width, height, depth) {
    const mesh = new THREE.Mesh(box, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    parent.add(mesh);
    return mesh;
}
/**
 * Assemble a small car from shared body, window, tire, and headlight materials.
 *
 * @param material - Shared Three.js material assigned to the created mesh.
 * @returns Mesh group containing the car body and visual details.
 */
function createCar(material) {
    const car = new THREE.Group();
    part(car, material, 0, .39, 0, .48, .25, .95);
    part(car, windows, 0, .59, -.05, .37, .2, .46);
    for (const x of [-.25, .25]) for (const z of [-.29, .29]) part(car, tires, x, .29, z, .09, .18, .18);
    for (const x of [-.15, .15]) part(car, paint, x, .41, .48, .1, .08, .02);
    return car;
}
/**
 * Create a walker with separate leg pivots for the walking animation.
 *
 * @param material - Shared Three.js material assigned to the created mesh.
 * @returns Walker mesh and leg pivots used for walking animation.
 */
function createPerson(material) {
    const person = new THREE.Group();
    part(person, material, 0, .52, 0, .18, .25, .13);
    const head = new THREE.Mesh(headGeometry, peopleColors[0]);
    head.position.y = .74;
    person.add(head);
    const limbs = [];
    for (const x of [-.065, .065]) {
        const leg = new THREE.Group();
        leg.position.set(x, .41, 0);
        part(leg, windows, 0, -.12, 0, .06, .24, .07);
        person.add(leg);
        limbs.push(leg);
    }
    return { mesh: person, limbs };
}
// Offset Voronoi boundaries provide separate lanes and pavement routes.
/**
 * Sample a pedestrian's pavement route and animate leg rotations.
 *
 * @param mover - Agent and its current mesh, path, speed, and walking animation phase.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function placeMover(mover) {
    const point = samplePath(mover.path, mover.distance);
    mover.mesh.position.set(point.x, 0, point.z);
    mover.mesh.rotation.y = point.angle;
    if (mover.limbs) mover.limbs.forEach((limb, i) => { limb.rotation.x = Math.sin(elapsed * 9 + mover.phase + i * Math.PI) * .55; });
}
/**
 * Create a reproducible random stream from a text seed.
 *
 * @param seed - Text or integer seed used to reproduce the procedural random field.
 * @returns Seeded random-number function returning repeatable values in [0, 1).
 */
function randomFor(seed) {
    let state = 2166136261;
    for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
    return () => {
        state += 0x6D2B79F5;
        let n = Math.imul(state ^ state >>> 15, 1 | state);
        n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
        return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
}
let generatedGeometry = [];
/**
 * Extrude an x/z footprint upward and track its geometry for later disposal.
 *
 * @param points - Polygon vertices or sample coordinates with x/z components.
 * @param material - Shared Three.js material assigned to the created mesh.
 * @param height - Extrusion or mesh height in world units.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function addPolygon(points, material, height) {
    if (points.length < 3) return;
    const shape = new THREE.Shape();
    shape.moveTo(points[0].x, -points[0].z);
    points.slice(1).forEach(p => shape.lineTo(p.x, -p.z));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    const vertices=geometry.attributes.position,normals=geometry.attributes.normal;
    const visible=[];
    for(let i=0;i<vertices.count;i+=3){
        if(normals.getY(i)<-.99&&normals.getY(i+1)<-.99&&normals.getY(i+2)<-.99)continue;
        visible.push(i,i+1,i+2);
    }
    geometry.setIndex(visible);
    generatedGeometry.push(geometry);
    city.add(new THREE.Mesh(geometry, material));
}
/**
 * Triangulate the land once as a single asphalt surface without overlapping solid bottoms.
 * @param patches - Convex land parcels covering the ant-generated footprint without overlap.
 * @returns No value; adds one shared roadbed mesh and tracks its geometry for disposal.
 */
function addLandSurface(patches){
    const positions=[];
    for(const polygon of patches){
        for(let i=1;i<polygon.length-1;i++){
            // Reverse the x/z winding so the surface normal points upward.
            for(const point of [polygon[0],polygon[i+1],polygon[i]])positions.push(point.x,.2,point.z);
        }
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.computeVertexNormals();generatedGeometry.push(geometry);
    city.add(new THREE.Mesh(geometry,roads));
}
/**
 * Replace the city, build its street graph, and spawn agents with valid routes.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns No value is returned; updates the current state, scene, or interface.
 */
function generate() {
    city.clear();
    generatedGeometry.forEach(geometry => geometry.dispose());
    generatedGeometry = [];
    movers = [];
    const size = Number(document.getElementById('size').value);
    const density = Number(document.getElementById('density').value) / 100;
    const maxHeight = Number(document.getElementById('height').value);
    const seed = document.getElementById('seed').value;
    const random = randomFor(seed);
    const {clusters, links, optimization, landPatches} = createNeighborhoods(size, random, Number(document.getElementById('ant-dots').value));
    const cells = clusters.flatMap(c => c.cells);
    const sites = clusters.flatMap(c => c.sites);
    const owners = clusters.flatMap(c => c.cells.map(() => c));
    // One asphalt roadbed under all blocks avoids coplanar faces at district boundaries.
    addLandSurface(landPatches);
    let count = 0, parkCount = 0, carCount = 0, pedestrianCount = 0;
    const trafficRandom = randomFor(seed + ':traffic');
    cells.forEach((cell, index) => {
        const cluster = owners[index];
        const districtId = cluster.typeId;
        const district = districtTypes[districtId];
        const pavement = inset(cell, .85);
        const footprint = inset(cell, 1.65);
        addPolygon(pavement, districtGround[districtId], .26);
        if (footprint.length >= 3) {
            if (random() > density * (1 - district.park)) {
                addPolygon(footprint, parks, .3);
                parkCount++;
            } else {
                const site = sites[index];
                const centrality = Math.max(0, 1 - Math.hypot(site.x - cluster.center.x, site.z - cluster.center.z) / cluster.radius);
                const height = 2 + random() * (maxHeight - 2) * (.25 + centrality * .75) * district.height;
                addPolygon(footprint, districtMaterials[districtId], height);
                count++;
            }
        }
        const walking = inset(cell, 1.2);
        if (walking.length >= 3 && pedestrianCount < 360) {
            const path = makePath(walking);
            for (let j = 0; j < 2; j++) {
                const person = createPerson(peopleColors[1 + (index + j) % 2]);
                city.add(person.mesh);
                movers.push({...person, path, distance: trafficRandom() * path.length, speed: .45 + trafficRandom() * .2, phase: trafficRandom() * Math.PI * 2});
                pedestrianCount++;
            }
        }
    });
    // District links are shared land borders, not detached connector corridors.
    for(const link of links){
        const [a,b]=link.points;
        const stripe=part(city,connectionMaterial,(a.x+b.x)/2,.23,(a.z+b.z)/2,.08,.02,Math.hypot(b.x-a.x,b.z-a.z));
        stripe.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);
    }
    streetGraph=buildStreetGraph(clusters,links);
    // Voronoi block setbacks already expose the roadbed. The graph is for navigation;
    // drawing a second box for each edge would overlap asphalt at every junction.
    carCount=Math.min(cells.length,100);
    for(let i=0;i<carCount;i++) {
        const car=createCar(carColors[i%carColors.length]);
        city.add(car);
        const agent=createTrafficAgent(streetGraph,i%clusters.length);
        // Stagger cars along their first real inter-district journey.
        const point=advanceTraffic(streetGraph,agent,trafficRandom()*20);
        car.position.set(point.x,0,point.z);car.rotation.y=point.angle;
        movers.push({mesh:car,agent,speed:1.7+trafficRandom()*.7});
    }
    document.getElementById('district-connections').textContent = [...new Set(links.map(link => [districtTypes[clusters[link.from].typeId].name,districtTypes[clusters[link.to].typeId].name].sort().join(' ↔ ')))].join(' · ');
    // Frame the continuous land footprint created by the ant colony.
    const bounds=new THREE.Box3().setFromObject(city);
    const center=bounds.getCenter(new THREE.Vector3());
    const span=bounds.getSize(new THREE.Vector3());
    const fit=Math.max(span.x,span.z)*1.1;
    controls.target.set(center.x,0,center.z);
    camera.position.set(center.x+fit,fit*.9,center.z+fit);
    controls.maxDistance=Math.max(400,fit*4);
    // Keep depth-buffer precision useful for centimeter-scale pavement layers at city scale.
    camera.near=Math.max(.5,fit/3000);
    camera.far=Math.max(1000,fit*10);
    camera.updateProjectionMatrix();
    movers.filter(mover=>!mover.agent).forEach(placeMover);
    document.getElementById('city-status').textContent = `${clusters.length} neighborhoods · 5 repeating district types · ${optimization.dots} colony dots · ${optimization.iterations} ant-colony footprint iterations · ${cells.length} blocks · ${count} buildings · ${parkCount} parks · ${carCount} cars · ${pedestrianCount} pedestrians`;
}
for (const id of ['size', 'density', 'height', 'ant-dots']) {
    document.getElementById(id).addEventListener('input', (event) => {
        document.getElementById(`${id}-value`).value = event.target.value + (id === 'density' ? '%' : '');
    });
}
document.getElementById('city-form').addEventListener('submit', (event) => { event.preventDefault(); generate(); });
document.getElementById('randomize').addEventListener('click', () => {
    document.getElementById('seed').value = `City ${Math.floor(Math.random() * 1000000)}`;
    generate();
});
// Recalculate view dimensions when the surrounding layout changes.
new ResizeObserver(() => {
    const width = Math.max(view.clientWidth, 1), height = Math.max(view.clientHeight, 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}).observe(view);
generate();
let lastTime;
// Keep visual frames separate from the simulation's own update timing.
renderer.setAnimationLoop((time) => {
    const dt = lastTime === undefined ? 0 : Math.min((time - lastTime) / 1000, .05);
    lastTime = time;
    elapsed += dt;
    for (const mover of movers) {
        if(mover.agent) {
            const point=advanceTraffic(streetGraph,mover.agent,mover.speed*dt);
            mover.mesh.position.set(point.x,0,point.z);
            mover.mesh.rotation.y=point.angle;
        } else {
            mover.distance = (mover.distance + mover.speed * dt) % mover.path.length;
            placeMover(mover);
        }
    }
    controls.update();
    renderer.render(scene, camera);
});
