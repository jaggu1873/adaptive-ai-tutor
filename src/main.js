import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { estimateMasteryFromHistory, loadProgress, recordAttempt, recordHintUse, saveProgress } from './progress-store.js';
import { analyzePdf, evaluateQuizAnswer, extractPdfPageTexts, generateTeachingResponse, makeDocumentQuiz } from './pdf-teaching-engine.js';
import { TeachingController } from './teaching-controller.js';
import { StudentKnowledgeModel } from './student-knowledge-model.js';
import { BrowserSpeechProvider } from './voice-provider.js';
import './style.css';

let pdfjsLib=null;
const speechProvider=new BrowserSpeechProvider();
const container = document.querySelector('#scene-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0a1a2c');
scene.fog = new THREE.Fog('#0a1a2c', 12, 25);

const camera = new THREE.PerspectiveCamera(39, container.clientWidth / container.clientHeight, 0.1, 100);
camera.position.set(0, 3.25, 10.8);
camera.lookAt(0, 2.05, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.domElement.setAttribute('aria-label', 'Interactive 3D classroom. Drag to rotate view.');
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xb7dcff, 0x26354b, 2.1));
const keyLight = new THREE.DirectionalLight(0xe3f4ff, 3.0);
keyLight.position.set(-3, 8, 6); keyLight.castShadow = true; keyLight.shadow.mapSize.set(1024, 1024); scene.add(keyLight);
const cyanLight = new THREE.PointLight(0x38d9ed, 22, 10); cyanLight.position.set(-3, 3.2, 1.7); scene.add(cyanLight);
const warmLight = new THREE.PointLight(0xffbf7a, 13, 10); warmLight.position.set(4, 4, -1); scene.add(warmLight);

const mat = (color, metalness = 0, roughness = 0.55, emissive = null) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...(emissive ? { emissive: new THREE.Color(emissive), emissiveIntensity: 0.45 } : {}) });
const materials = {
  floor: mat('#10243a', 0.25, 0.75), wall: mat('#122b43', 0.15, 0.8), trim: mat('#2d5675', 0.55, 0.35),
  white: mat('#d9eaff', 0.25, 0.3), robot: mat('#c7d9e8', 0.65, 0.25), robotDark: mat('#354e68', 0.7, 0.3),
  cyan: mat('#64edf4', 0.25, 0.2, '#20cfe6'), blue: mat('#438dff', 0.25, 0.25, '#256bff'), board: mat('#f0f5fb', 0.05, 0.45), black: mat('#0a1828', 0.25, 0.25),
};
function addMesh(geometry, material, parent, x, y, z, cast = true, receive = true) {
  const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = receive; parent.add(mesh); return mesh;
}
function box(parent, w, h, d, material, x, y, z, radius = 0) {
  // Box geometry is used for crisp classroom furniture and robot armor.
  return addMesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z);
}
function cylinder(parent, rTop, rBottom, h, material, x, y, z, segments = 24) {
  return addMesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material, parent, x, y, z);
}
function sphere(parent, r, material, x, y, z, sx = 1, sy = 1, sz = 1) {
  const mesh = addMesh(new THREE.SphereGeometry(r, 24, 16), material, parent, x, y, z); mesh.scale.set(sx, sy, sz); return mesh;
}
function line(parent, points, color = '#438dff', radius = 0.018) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return addMesh(new THREE.TubeGeometry(curve, 24, radius, 6, false), mat(color, 0.25, 0.35, color), parent, 0, 0, 0, false, false);
}

// Stage and architectural backdrop
box(scene, 18, 0.18, 13, materials.floor, 0, -0.1, -2);
box(scene, 18, 7, 0.22, materials.wall, 0, 3.4, -5.7, 0);
box(scene, 18, 0.06, 13, mat('#294661', 0.3, 0.6), 0, -0.19, -2, 0);
// Back-wall illuminated vertical panels
for (let x = -7; x <= 7; x += 2) {
  box(scene, 0.018, 5.6, 0.025, mat('#214968', 0.3, 0.4, '#173958'), x, 3.25, -5.56, 0);
}
// Ceiling lights
for (const x of [-4.2, 0, 4.2]) {
  box(scene, 1.35, 0.035, 0.35, mat('#b9f5ff', 0.1, 0.2, '#54dff3'), x, 6.45, -1.8, 0);
}

// Large whiteboard with dark metal frame. Board is positioned to the robot's right.
const board = new THREE.Group(); scene.add(board); board.position.set(1.85, 0, -1.55);
box(board, 5.35, 3.65, 0.20, materials.trim, 0, 3.15, 0);
box(board, 5.16, 3.46, 0.045, materials.board, 0, 3.15, 0.12);
box(board, 5.38, 0.10, 0.32, materials.trim, 0, 1.28, 0.02);
for (const x of [-1.95, 1.95]) box(board, 0.10, 1.1, 0.10, materials.trim, x, 0.62, 0.02);
// Whiteboard writing uses a canvas texture so lesson text is crisp and can be changed live.
const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1200; boardCanvas.height = 760;
const ctx = boardCanvas.getContext('2d');
const boardTexture = new THREE.CanvasTexture(boardCanvas); boardTexture.colorSpace = THREE.SRGBColorSpace;
const writingMaterial = new THREE.MeshBasicMaterial({ map: boardTexture, transparent: true, depthWrite: false });
const writingPlane = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 3.34), writingMaterial);
writingPlane.position.set(0, 3.15, 0.151); board.add(writingPlane);
function drawBoard({ title = 'LESSON 01  ·  ARTIFICIAL NEURONS', subtitle = 'A neuron transforms inputs into a prediction.', equation = 'z = w₁x₁ + w₂x₂ + b', note = 'INPUTS  →  WEIGHTED SUM  →  ACTIVATION', color = '#1671b9', kind = 'neuron', reveal = 3 } = {}) {
  const W = boardCanvas.width, H = boardCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f7fbff'; ctx.fillRect(0, 0, W, H);
  // Header and clean classroom-board layout
  ctx.fillStyle = color; ctx.fillRect(0, 0, W, 92);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 30px Arial'; ctx.fillText(title, 34, 58);
  ctx.fillStyle = '#d8e8f7'; ctx.fillRect(0, 92, W, 5);
  ctx.fillStyle = '#203b5c'; ctx.font = '25px Arial'; wrapText(ctx, subtitle, 42, 145, 1090, 34);
  if (reveal < 1) { boardTexture.needsUpdate = true; return; }

  // Left: neuron calculation with weighted inputs
  ctx.fillStyle = '#e9f4ff'; ctx.strokeStyle = '#d3e5f7'; ctx.lineWidth = 2;
  roundRect(ctx, 30, 180, 620, 420, 22); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#1d4777'; ctx.font = 'bold 25px Arial'; ctx.fillText(kind === 'relu' ? 'ACTIVATION RULE' : kind === 'learning' ? 'LEARNING EQUATION' : 'ARTIFICIAL NEURON', 55, 222);
  ctx.fillStyle = '#0d3d6c'; ctx.font = 'bold 42px Georgia'; ctx.fillText(equation, 55, 286);
  if (reveal < 2) { boardTexture.needsUpdate = true; return; }
  if (kind === 'relu') {
    ctx.fillStyle = '#e9f4ff'; ctx.strokeStyle = '#d3e5f7'; ctx.lineWidth = 2;
    roundRect(ctx, 30, 180, 1140, 420, 22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1d4777'; ctx.font = 'bold 25px Arial'; ctx.fillText('TRY TWO INPUTS', 58, 226);
    const examples = [{ y: 330, input: '−3', output: '0', label: 'negative input' }, { y: 445, input: '5', output: '5', label: 'positive input' }];
    examples.forEach(({ y, input, output, label }) => {
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#9cb9d7'; ctx.lineWidth = 3;
      roundRect(ctx, 90, y - 43, 205, 82, 15); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#234a72'; ctx.font = 'bold 27px Arial'; ctx.fillText(`${label}: ${input}`, 111, y + 9);
      ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(310, y); ctx.lineTo(455, y); ctx.stroke();
      ctx.fillStyle = '#f0eaff'; ctx.strokeStyle = color; roundRect(ctx, 455, y - 38, 205, 76, 14); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4d3682'; ctx.font = 'bold 26px Arial'; ctx.fillText('ReLU', 520, y + 9);
      ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(675, y); ctx.lineTo(800, y); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#9cb9d7'; roundRect(ctx, 800, y - 43, 205, 82, 15); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#234a72'; ctx.font = 'bold 27px Arial'; ctx.fillText(`output: ${output}`, 826, y + 9);
    });
    ctx.fillStyle = '#315779'; ctx.font = 'bold 21px Arial'; ctx.fillText('Negative values become zero. Positive values pass through.', 90, 555);
    if (reveal < 3) { boardTexture.needsUpdate = true; return; }
    ctx.clearRect(30, 180, 1140, 420);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d3e5f7'; ctx.lineWidth = 2;
    roundRect(ctx, 30, 180, 1140, 420, 22); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 26px Arial'; ctx.fillText('THE ReLU GRAPH', 70, 230);
    ctx.fillStyle = '#315779'; ctx.font = '22px Arial'; ctx.fillText('Below zero, the output stays at zero. Above zero, it rises with the input.', 70, 275);
    const ox = 560, oy = 500;
    ctx.strokeStyle = '#6f89a7'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(170, oy); ctx.lineTo(1000, oy); ctx.moveTo(ox, 540); ctx.lineTo(ox, 325); ctx.stroke();
    ctx.fillStyle = '#516b89'; ctx.font = '20px Arial'; ctx.fillText('input (z)', 1005, oy + 7); ctx.fillText('output', ox + 14, 325);
    ctx.strokeStyle = color; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(250, oy); ctx.lineTo(ox, oy); ctx.lineTo(830, 365); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = '#4d3682'; ctx.font = 'bold 25px Arial'; ctx.fillText('ReLU(z) = max(0, z)', 70, 565);
    boardTexture.needsUpdate = true; return;
  }
  if (kind === 'learning') {
    ctx.fillStyle = '#e9f4ff'; ctx.strokeStyle = '#d3e5f7'; ctx.lineWidth = 2;
    roundRect(ctx, 30, 180, 1140, 420, 22); ctx.fill(); ctx.stroke();
    const node = (x, y, w, label, fill) => {
      ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = 3;
      roundRect(ctx, x, y, w, 110, 16); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#203b5c'; ctx.font = 'bold 25px Arial'; ctx.textAlign = 'center';
      wrapText(ctx, label, x + 18, y + 44, w - 36, 32); ctx.textAlign = 'left';
    };
    if (reveal >= 2) {
      ctx.fillStyle = '#1d4777'; ctx.font = 'bold 25px Arial'; ctx.fillText('THE LEARNING LOOP', 60, 230);
      node(70, 300, 250, '1. Make a prediction', '#ffffff');
      node(470, 300, 250, '2. Measure the error', '#fff7e8');
      node(870, 300, 240, '3. Adjust the weights', '#e8f8f5');
      [[325, 425], [725, 825]].forEach(([from, to]) => {
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(from, 355); ctx.lineTo(to, 355);
        ctx.lineTo(to - 13, 345); ctx.moveTo(to, 355); ctx.lineTo(to - 13, 365); ctx.stroke();
      });
      if (reveal >= 3) {
        ctx.strokeStyle = '#2b9c83'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(990, 430); ctx.lineTo(990, 505); ctx.lineTo(195, 505); ctx.lineTo(195, 430); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(195, 430); ctx.lineTo(184, 445); ctx.moveTo(195, 430); ctx.lineTo(206, 445); ctx.stroke();
        ctx.fillStyle = '#315779'; ctx.font = 'bold 20px Arial'; ctx.fillText('Repeat with improved weights until the error gets smaller.', 275, 555);
      }
    }
    boardTexture.needsUpdate = true; return;
  }
  const inputs = [{x:92,y:365,label:'x₁',weight:'w₁'},{x:92,y:445,label:'x₂',weight:'w₂'},{x:92,y:525,label:'x₃',weight:'w₃'}];
  const sum = {x:330,y:445};
  ctx.lineWidth = 5;
  inputs.forEach((n,i)=>{
    ctx.strokeStyle = ['#3988df','#18a6a1','#b16ce0'][i];
    ctx.beginPath(); ctx.moveTo(n.x+35,n.y); ctx.lineTo(sum.x-42,sum.y); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(n.x,n.y,29,0,Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#234a72'; ctx.font = 'bold 24px Arial'; ctx.fillText(n.label,n.x-13,n.y+8);
    ctx.fillStyle = '#345d84'; ctx.font = '20px Arial'; ctx.fillText(n.weight,178,n.y-12);
  });
  ctx.fillStyle = '#d7edff'; ctx.strokeStyle = '#236bb0'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(sum.x,sum.y,43,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#164b7b'; ctx.font = 'bold 40px Arial'; ctx.fillText('Σ',sum.x-15,sum.y+14);
  ctx.strokeStyle = '#236bb0'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(374,445); ctx.lineTo(438,445); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#5288bf'; ctx.lineWidth = 3; roundRect(ctx,438,405,104,80,13); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#194a7b'; ctx.font = 'bold 30px Georgia'; ctx.fillText('f(z)',457,453);
  ctx.strokeStyle = '#236bb0'; ctx.beginPath(); ctx.moveTo(542,445); ctx.lineTo(590,445); ctx.stroke();
  ctx.fillStyle = '#1b4f7d'; ctx.font = 'bold 27px Arial'; ctx.fillText('ŷ',594,453);

  // Right: activation function graph is revealed after the neuron diagram.
  if (reveal < 3) { boardTexture.needsUpdate = true; return; }
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#d3e5f7'; ctx.lineWidth = 2;
  roundRect(ctx, 675, 180, 495, 420, 22); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.font = 'bold 25px Arial'; ctx.fillText('ACTIVATION FUNCTION', 704, 222);
  ctx.fillStyle = '#1b3550'; ctx.font = 'bold 31px Georgia'; ctx.fillText(currentBoardActivation(equation), 704, 274);
  const ox=850, oy=470;
  ctx.strokeStyle='#6f89a7';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(715,oy);ctx.lineTo(1105,oy);ctx.moveTo(ox,555);ctx.lineTo(ox,315);ctx.stroke();
  ctx.beginPath();ctx.moveTo(1105,oy);ctx.lineTo(1090,oy-8);ctx.moveTo(1105,oy);ctx.lineTo(1090,oy+8);ctx.moveTo(ox,315);ctx.lineTo(ox-8,330);ctx.moveTo(ox,315);ctx.lineTo(ox+8,330);ctx.stroke();
  ctx.fillStyle='#516b89';ctx.font='20px Arial';ctx.fillText('0',ox-15,oy+25);ctx.fillText('z',1112,oy+7);ctx.fillText('f(z)',ox+13,315);
  ctx.strokeStyle= color; ctx.lineWidth=7; ctx.lineCap='round'; ctx.beginPath();
  if (equation.toLowerCase().includes('relu')) { ctx.moveTo(730,oy);ctx.lineTo(ox,oy);ctx.lineTo(1010,345); }
  else if (equation.toLowerCase().includes('prediction')) { ctx.moveTo(735,530);ctx.lineTo(815,430);ctx.lineTo(900,470);ctx.lineTo(1000,370);ctx.lineTo(1080,390); }
  else { ctx.moveTo(730,oy+18);ctx.bezierCurveTo(780,oy+18,800,oy-12,ox,oy);ctx.bezierCurveTo(910,oy-12,930,oy-100,1040,oy-115); }
  ctx.stroke(); ctx.lineCap='butt';
  ctx.fillStyle = '#eaf6ff'; ctx.strokeStyle = '#c6e0f7'; roundRect(ctx, 700, 535, 440, 42, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#315779'; ctx.font = 'bold 19px Arial'; ctx.fillText(note, 718, 562);
  boardTexture.needsUpdate = true;
}
function showPdfOnBoard(pageCanvas, pageNumber, fileName) {
  ctx.fillStyle='#f7fbff';ctx.fillRect(0,0,boardCanvas.width,boardCanvas.height);
  ctx.fillStyle='#1671b9';ctx.fillRect(0,0,boardCanvas.width,92);
  ctx.fillStyle='#fff';ctx.font='bold 28px Arial';ctx.fillText(`${fileName} · PAGE ${pageNumber}`,28,58);
  const maxWidth=1140,maxHeight=630,scale=Math.min(maxWidth/pageCanvas.width,maxHeight/pageCanvas.height);
  const width=pageCanvas.width*scale,height=pageCanvas.height*scale;
  ctx.drawImage(pageCanvas,(boardCanvas.width-width)/2,112+(maxHeight-height)/2,width,height);
  boardTexture.needsUpdate=true;
}
function roundRect(context, x, y, w, h, r) {
  context.beginPath(); context.moveTo(x+r,y); context.arcTo(x+w,y,x+w,y+h,r); context.arcTo(x+w,y+h,x,y+h,r); context.arcTo(x,y+h,x,y,r); context.arcTo(x,y,x+w,y,r); context.closePath();
}
function currentBoardActivation(equation) {
  if (equation.toLowerCase().includes('relu')) return 'ReLU: max(0, z)';
  if (equation.toLowerCase().includes('prediction')) return 'Predict → Measure → Adjust';
  return 'Weighted sum → Output';
}
function wrapText(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' '); let lineText = ''; let yy = y;
  for (const word of words) { const test = lineText + word + ' '; if (context.measureText(test).width > maxWidth && lineText) { context.fillText(lineText, x, yy); lineText = word + ' '; yy += lineHeight; } else lineText = test; }
  context.fillText(lineText, x, yy);
}
drawBoard();

// Cinematic human-like teacher, built procedurally so the project works without paid assets.
// A rigged GLB can replace this fallback in the next stage.
const teacher = new THREE.Group(); teacher.name = 'ProceduralHumanTeacher'; scene.add(teacher); teacher.position.set(-2.35, 0, 0.0);
const skin = mat('#c88f70', 0.02, 0.72);
const skinLight = mat('#d9a383', 0.01, 0.68);
const hairMat = mat('#211b1c', 0.08, 0.5);
const jacketMat = mat('#183a5c', 0.24, 0.38);
const jacketLight = mat('#28577e', 0.2, 0.42);
const shirtMat = mat('#e9f2fb', 0.02, 0.48);
const trouserMat = mat('#17273a', 0.12, 0.55);
const shoeMat = mat('#101923', 0.18, 0.4);
const accentMat = mat('#61e7ed', 0.18, 0.28, '#1acfe0');
function capsule(parent, radius, length, material, x, y, z, scaleX=1, scaleY=1, scaleZ=1) {
  const m = addMesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material, parent, x, y, z);
  m.scale.set(scaleX, scaleY, scaleZ); return m;
}
function bone(parent, a, b, radius, material) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const delta = vb.clone().sub(va);
  const mesh = addMesh(new THREE.CylinderGeometry(radius*0.88, radius, delta.length(), 14), material, parent,
    (va.x+vb.x)/2, (va.y+vb.y)/2, (va.z+vb.z)/2);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), delta.normalize());
  return mesh;
}
// Shoes and legs
for (const x of [-0.25, 0.25]) {
  box(teacher, 0.34, 0.16, 0.52, shoeMat, x, 0.12, 0.12);
  capsule(teacher, 0.13, 0.48, trouserMat, x, 0.48, 0, 1, 1.0, 1.0);
  capsule(teacher, 0.145, 0.36, trouserMat, x*0.96, 0.88, 0, 1, 1.0, 1.0);
  sphere(teacher, 0.15, jacketMat, x*0.96, 1.08, 0);
}
// Torso, shirt, jacket lapels and belt
capsule(teacher, 0.36, 0.66, jacketMat, 0, 1.62, 0, 1.05, 1.1, 0.78);
box(teacher, 0.25, 0.68, 0.035, shirtMat, 0, 1.62, 0.285);
const lapelL = addMesh(new THREE.BufferGeometry(), jacketLight, teacher, -0.14, 1.8, 0.31);
const lapelR = addMesh(new THREE.BufferGeometry(), jacketLight, teacher, 0.14, 1.8, 0.31);
// Small tailored lapels, simple triangular shapes
function triangle(parent, points, material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(),3));
  geometry.setIndex([0,1,2]); geometry.computeVertexNormals();
  return addMesh(geometry, material, parent, 0,0,0, false, false);
}
teacher.remove(lapelL); teacher.remove(lapelR);
triangle(teacher,[[-0.27,2.02,0.30],[-0.02,1.84,0.34],[-0.12,1.60,0.32]],jacketLight);
triangle(teacher,[[0.27,2.02,0.30],[0.02,1.84,0.34],[0.12,1.60,0.32]],jacketLight);
box(teacher,0.46,0.08,0.035,mat('#0e2339',0.25,0.4),0,1.20,0.28);
box(teacher,0.09,0.09,0.04,accentMat,0,1.20,0.31);
// Neck and head
cylinder(teacher,0.13,0.14,0.24,skin,0,2.12,0,20);
const head = new THREE.Group(); teacher.add(head); head.position.set(0,2.52,0.025);
sphere(head,0.36,skin,0,0,0,0.91,1.12,0.83);
sphere(head,0.12,skinLight,-0.34,-0.02,0.01,0.65,1.0,0.7);
sphere(head,0.12,skinLight,0.34,-0.02,0.01,0.65,1.0,0.7);
sphere(head,0.14,skin,0,-0.245,0.205,1.0,0.48,0.5);
// Hair cap and swept fringe
sphere(head,0.365,hairMat,0,0.16,-0.035,0.98,0.68,0.88);
sphere(head,0.23,hairMat,-0.12,0.24,0.19,1.0,0.44,0.45);
sphere(head,0.18,hairMat,0.13,0.22,0.22,1.0,0.40,0.42);
// Face features facing the camera (+Z)
const eyes=[];
for (const x of [-0.135,0.135]) {
  const whiteEye=sphere(head,0.043,mat('#fffaf2'),x,0.035,0.292,1,0.78,0.35);
  const iris=sphere(head,0.025,mat('#684635'),x,0.035,0.312,1,1,0.4);
  const pupil=sphere(head,0.013,mat('#201a19'),x,0.035,0.322,1,1,0.4);
  sphere(head,0.006,mat('#ffffff'),x-0.006,0.045,0.332,1,1,0.4);
  eyes.push({whiteEye,iris,pupil});
  // brows
  bone(head,[x-0.055,0.105,0.29],[x+0.045,0.12,0.29],0.018,hairMat);
}
bone(head,[0,0.015,0.30],[0.015,-0.095,0.345],0.025,skinLight);
sphere(head,0.07,skinLight,0,-0.14,0.29,1.0,0.42,0.35);
const mouth = sphere(head, 0.105, mat('#673c36', 0, 0.8), 0, -0.19, 0.307, 1, 0.08, 0.24);
// Hair side locks
sphere(head,0.09,hairMat,-0.31,0.10,0.04,0.65,1.2,0.8);
sphere(head,0.09,hairMat,0.31,0.10,0.04,0.65,1.2,0.8);
// Teacher's right arm: articulated shoulder, upper arm, forearm and pointing index finger.
const pointingArm = new THREE.Group(); teacher.add(pointingArm); pointingArm.position.set(0.34,2.10,0);
sphere(pointingArm,0.15,jacketLight,0,0,0);
bone(pointingArm,[0,0,0],[0.30,0.31,0],0.105,jacketMat);
sphere(pointingArm,0.105,skin,0.30,0.31,0.01);
bone(pointingArm,[0.30,0.31,0.01],[0.70,0.57,0.05],0.082,jacketLight);
sphere(pointingArm,0.09,skin,0.70,0.57,0.05);
const hand = new THREE.Group(); pointingArm.add(hand); hand.position.set(0.73,0.59,0.05);
sphere(hand,0.105,skin,0.02,0,0,1.1,0.75,0.72);
bone(hand,[0.06,0.025,0.01],[0.50,0.19,0.02],0.027,skinLight);
for (let i=0;i<3;i++) bone(hand,[-0.005+i*0.045,-0.015,0.015],[0.07+i*0.055,-0.105,0.02],0.022,skin);
// Other arm, held slightly open as a presenter
const restingArm = new THREE.Group(); teacher.add(restingArm); restingArm.position.set(-0.34,1.96,0);
sphere(restingArm,0.15,jacketLight,0,0,0);
bone(restingArm,[0,0,0],[-0.16,-0.30,0],0.105,jacketMat);
sphere(restingArm,0.10,skin,-0.16,-0.30,0);
bone(restingArm,[-0.16,-0.30,0],[-0.12,-0.62,0.06],0.078,jacketLight);
sphere(restingArm,0.085,skin,-0.12,-0.64,0.06);
for(let i=0;i<4;i++) bone(restingArm,[-0.12+i*0.025,-0.65,0.06],[-0.11+i*0.03,-0.76,0.07],0.018,skinLight);
// Accent floor ring under teacher
const teacherHalo = addMesh(new THREE.TorusGeometry(0.56,0.012,8,64), accentMat, scene, -2.35, 0.015, 0.0, false, false); teacherHalo.rotation.x = Math.PI/2;
let teacherMixer = null;
let teacherActions = new Map();
let activeTeacherAction = null;
let teacherMouthMorphs = [];
let teacherBlinkMorphs = [];
let teacherJawBone = null;
let teacherJawBaseRotation = 0;
const configuredTeacherModel = import.meta.env.VITE_TEACHER_MODEL_URL;
function setTeacherAnimation(state) {
  if (!teacherMixer || !teacherActions.size) return;
  const patterns = {
    idle: /idle|stand|breath/,
    speaking: /speak|talk|explain/,
    listening: /listen|attentive/,
    greeting: /greet|wave|hello/,
    pointing: /point|present|teach/,
    thinking: /think|ponder/,
  };
  const action = [...teacherActions.entries()].find(([name]) => patterns[state]?.test(name))?.[1]
    || teacherActions.get('idle');
  if (!action || action === activeTeacherAction) return;
  action.reset().fadeIn(0.3).play();
  activeTeacherAction?.fadeOut(0.3);
  activeTeacherAction = action;
}
if (configuredTeacherModel) {
  const loader = new GLTFLoader();
  document.getElementById('teacher-status').textContent='Loading licensed teacher model…';
  document.getElementById('teacher-substatus').textContent='The procedural teacher remains available until the model loads.';
  loader.load(configuredTeacherModel, gltf => {
    const model = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0) {
      setStatus('Teacher model could not be displayed.','The GLB has no measurable geometry; using the built-in teacher.');
      return;
    }
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = 2.9 / size.y;
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    teacher.add(model);
    teacher.children.filter(child => child !== model).forEach(child => { child.visible = false; });
    model.traverse(object=>{
      if(object.isBone&&/jaw/i.test(object.name)){teacherJawBone=object;teacherJawBaseRotation=object.rotation.x;}
      if(!object.isMesh||!object.morphTargetDictionary||!object.morphTargetInfluences)return;
      Object.entries(object.morphTargetDictionary).forEach(([name,index])=>{
        if(/mouth.?open|viseme.?[aou]|jaw.?open/i.test(name))teacherMouthMorphs.push({mesh:object,index});
        if(/blink|eye.?close/i.test(name))teacherBlinkMorphs.push({mesh:object,index});
      });
    });
    teacherMixer = new THREE.AnimationMixer(model);
    teacherActions = new Map(gltf.animations.map(clip => [clip.name.toLowerCase(), teacherMixer.clipAction(clip)]));
    setTeacherAnimation('greeting');
    setTimeout(()=>{if(!teacherSpeaking&&!teacherListening)setTeacherAnimation('idle');},1600);
    if(!teacherSpeaking&&!teacherListening)setStatus('Human teacher model loaded.','Select Teach this lesson to begin.');
  }, undefined, error => {
    console.error('Could not load configured teacher GLB; using procedural fallback.', error);
    if(!teacherSpeaking&&!teacherListening)setStatus('Teacher model could not be loaded.','Using the built-in teacher. Check VITE_TEACHER_MODEL_URL and the asset file.');
  });
}
// Classroom floating decorative lights
for (let i=0;i<18;i++) {
  const x=-6.5+(i%9)*1.55, y=1.1+Math.floor(i/9)*2.5, z=-4.9;
  sphere(scene,0.025,mat(i%3===0?'#5ce4ed':'#5284be',0.1,0.3,i%3===0?'#5ce4ed':'#5284be'),x,y,z,1,1,1);
}

// Minimal orbit interaction: drag to rotate around the room; wheel to zoom.
let dragging=false, lastX=0, lastY=0, yaw=0, pitch=0;
renderer.domElement.addEventListener('pointerdown', e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;renderer.domElement.setPointerCapture(e.pointerId);});
renderer.domElement.addEventListener('pointermove', e=>{if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;yaw-=dx*0.004;pitch=Math.max(-0.22,Math.min(0.35,pitch+dy*0.003));});
renderer.domElement.addEventListener('pointerup',()=>dragging=false);renderer.domElement.addEventListener('pointercancel',()=>dragging=false);
let cameraDistance=10.8;
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();cameraDistance=Math.max(7.4,Math.min(13,cameraDistance+e.deltaY*0.008));},{passive:false});

const lessons = [
  {title:'What is an artificial neuron?',description:'A neuron combines inputs and weights, adds a bias, then uses an activation function to produce an output.',equation:'z = w₁x₁ + w₂x₂ + b',board:{title:'TODAY: ARTIFICIAL NEURONS',subtitle:'A neuron turns inputs into an output.',equation:'z = w₁x₁ + w₂x₂ + b',note:'INPUTS  →  WEIGHTED SUM  →  ACTIVATION',color:'#1671b9'},steps:[
    {conceptTitle:'Neuron inputs',keyPoints:['Inputs represent information'],expectedOutcome:'Identify the inputs to a neuron.',gesture:'pointing',speech:'An artificial neuron is a small calculation unit. It starts with input values, such as measurements or words, represented here by x one, x two, and x three.',reveal:1},
    {conceptTitle:'Weighted sum',keyPoints:['Weights set input importance','Bias shifts the weighted sum'],expectedOutcome:'Explain how inputs and weights produce z.',gesture:'explaining',speech:'Each input gets multiplied by a weight. The weights control how strongly each input matters. We add those weighted values together, then add a bias. That gives us z.',reveal:2},
    {conceptTitle:'Neuron output',keyPoints:['Activation transforms z'],expectedOutcome:'Trace the signal from inputs to output.',gesture:'pointing',speech:'Finally, an activation function transforms z into the neuron’s output. The drawing shows the whole path: inputs, weighted sum, activation, and prediction.',reveal:3}
  ]},
  {title:'What does an activation function do?',description:'An activation function transforms a neuron’s weighted sum. ReLU sets negative values to zero and passes positive values through.',equation:'ReLU(z) = max(0, z)',board:{title:'CONCEPT 02: ACTIVATION',subtitle:'ReLU lets positive values pass through.',equation:'ReLU(z) = max(0, z)',note:'IF z < 0  →  0     |     IF z ≥ 0  →  z',color:'#6744b5',kind:'relu'},steps:[
    {speech:'An activation function decides what signal leaves a neuron. We will use ReLU, short for Rectified Linear Unit. Its rule is simple: return the larger of zero and the input.',reveal:1},
    {speech:'Let us test the rule. If the input is negative three, ReLU returns zero. If the input is positive five, ReLU returns five. The diagram writes out both examples.',reveal:2},
    {speech:'Now look at the graph. On the negative side, the output stays at zero. Once the input becomes positive, the output rises with it. That is why ReLU is written as max of zero and z.',reveal:3}
  ]},
  {title:'How does a network learn?',description:'A network makes a prediction, measures its error against the correct answer, and adjusts its weights to improve.',equation:'Prediction → Loss → Weight update',board:{title:'CONCEPT 03: LEARNING',subtitle:'A model learns by reducing prediction error.',equation:'Prediction  →  Loss  →  Weight update',note:'PREDICT  →  MEASURE ERROR  →  ADJUST',color:'#147d70',kind:'learning'},steps:[
    {speech:'A neural network learns by trying, checking, and improving. First it uses its current weights to make a prediction.',reveal:1},
    {speech:'Next, a loss function compares the prediction with the correct answer. The difference is called the error. A larger error means the prediction needs more improvement.',reveal:2},
    {speech:'An optimizer adjusts the weights to reduce that error. Then the network predicts again and repeats the loop. The goal is to make the error smaller over time.',reveal:3}
  ]}
];
let learningProgress=loadProgress();
const knowledgeModel=new StudentKnowledgeModel();
let currentLesson=Math.min(learningProgress.lessonIndex,lessons.length-1); let speechUtterance=null; let teacherSpeaking=false; let teacherGesture=0; let teacherListening=false;
let speechWordStartedAt=0; let speechWordDuration=280; let speechWordSyllables=1; let speechHasBoundaries=false;
let lessonPlayback=null; let teachingController=null; let pdfDocument=null; let pdfPageTexts=[]; let pdfFileName='';
let activePdfTeaching=null;let pdfLoadId=0;let pdfRenderId=0;
const $=id=>document.getElementById(id);
function setStatus(title,sub){
  $('teacher-status').textContent=title;$('teacher-substatus').textContent=sub;
  const badge=$('classroom-badge');
  const state=/listening/i.test(title)?'LISTENING':/speaking/i.test(title)?'SPEAKING':/paused/i.test(title)?'PAUSED':/could not|not supported|issue/i.test(title)?'CHECK AUDIO':'READY';
  badge.dataset.state=state.toLowerCase();
  const icon=badge.querySelector('i');
  badge.replaceChildren(icon,document.createTextNode(` ${state}`));
}
const voiceSelect=$('voice-select');
function availableEnglishVoices(){return speechProvider.voices().filter(voice=>/^en[-_]/i.test(voice.lang));}
function preferredVoice(voices){return [...voices].sort((a,b)=>voiceScore(b)-voiceScore(a))[0]||null;}
function voiceScore(voice){const name=voice.name.toLowerCase();return (/natural|neural|enhanced|premium|google|microsoft|aria|jenny|guy|david|samantha/.test(name)?4:0)+(/^en-us/i.test(voice.lang)?2:0)+(!voice.localService?1:0);}
function updateVoiceOptions(){
  if(!voiceSelect)return;
  const selected=voiceSelect.value;
  const voices=availableEnglishVoices();
  voiceSelect.replaceChildren(new Option('Automatic · clearest English voice',''));
  voices.forEach(voice=>voiceSelect.add(new Option(`${voice.name} (${voice.lang})`,voice.name)));
  if(voices.some(voice=>voice.name===selected))voiceSelect.value=selected;
}
if(speechProvider.supported){updateVoiceOptions();speechProvider.onVoicesChanged(updateVoiceOptions);}
function cancelSpeech(){speechProvider.stop();speechUtterance=null;resetSpeechAnimation();teacherGesture=0;}
function stopCurrentSpeech(){lessonPlayback=null;if(teachingController)teachingController.stop();else cancelSpeech();}
function showLesson(index, speak=false){
  activePdfTeaching=null;
  currentLesson=(index+lessons.length)%lessons.length;
  $('visual-mode').value='lesson';
  const lesson=lessons[currentLesson];
  $('lesson-title').textContent=lesson.title;$('lesson-description').textContent=lesson.description;$('equation').textContent=lesson.equation;
  $('step-count').textContent=`${String(currentLesson+1).padStart(2,'0')} / ${String(lessons.length).padStart(2,'0')}`;
  if(speak){learningProgress.lessonIndex=currentLesson;learningProgress.stepIndex=0;saveProgress(learningProgress);teachingController.start(lesson,currentLesson,0);}
  else{stopCurrentSpeech();drawBoard(lesson.board);setStatus('Your teacher is ready.','Start the explanation to learn this concept step by step.');}
}
function setVoiceButtonLabel(label){$('stop-speaking').querySelector('strong').textContent=label;}
function resetSpeechAnimation(){teacherSpeaking=false;speechHasBoundaries=false;mouth.scale.y=0.08;setVoiceButtonLabel("Pause the teacher's voice");$('stop-speaking').disabled=true;setTeacherAnimation('idle');}
function makeSpeechFriendly(text){
  return text.replace(/\bReLU\(z\)\s*=\s*max\s*\(0,\s*z\)/gi,'ReLU of z is the maximum of zero and z')
    .replace(/\bmax\s*\(0,\s*z\)/gi,'the maximum of zero and z')
    .replace(/[xw]₁/g,match=>`${match[0]} one`).replace(/[xw]₂/g,match=>`${match[0]} two`).replace(/[xw]₃/g,match=>`${match[0]} three`)
    .replace(/→/g,' followed by ').replace(/\*\*/g,'').replace(/`/g,'');
}
function speakText(text,handlers={}){
  teacherGesture=1;teacherListening=false;
  if(!speechProvider.supported){setStatus('Speech is not supported here.','Try a recent version of Chrome or Edge.');handlers.onError?.();return;}
  const voices=availableEnglishVoices();
  const spokenText=makeSpeechFriendly(text);
  const utterance=speechProvider.speak(spokenText,{
    voice:voices.find(voice=>voice.name===voiceSelect.value)||preferredVoice(voices),
    rate:Number($('voice-rate').value),pitch:0.98,volume:1,
    onStart:()=>{
      if(speechUtterance!==utterance)return;
      teacherSpeaking=true;teacherGesture=1;speechWordStartedAt=performance.now();speechHasBoundaries=false;
      setTeacherAnimation('speaking');
      $('stop-speaking').disabled=false;
      setVoiceButtonLabel("Pause the teacher's voice");
      setStatus('Your teacher is speaking…',lessonPlayback
        ?`Concept ${lessonPlayback.stepIndex+1} of ${lessons[lessonPlayback.lessonIndex].steps.length} · Listen, then watch the board update.`
        :'Watch your teacher’s lips move with the spoken explanation.');
    },
    onBoundary:event=>{
      if(speechUtterance!==utterance||event.name!=='word')return;
      const start=event.charIndex||0;
      const word=(spokenText.slice(start).match(/^[\p{L}\p{N}']+/u)||[''])[0];
      if(!word)return;
      speechHasBoundaries=true;speechWordStartedAt=performance.now();
      speechWordSyllables=Math.max(1,(word.match(/[aeiouy]+/gi)||[]).length);
      speechWordDuration=Math.max(140,Math.min(520,word.length*62/utterance.rate));
    },
    onEnd:()=>{
      if(speechUtterance!==utterance)return;
      speechUtterance=null;
      resetSpeechAnimation();
      if(handlers.onComplete){handlers.onComplete();return;}
      teacherGesture=0;
      setStatus('Explanation complete.','Ask a question or continue to the next concept.');
    },
    onError:()=>{
      if(speechUtterance!==utterance)return;
      speechUtterance=null;
      resetSpeechAnimation();teacherGesture=0;
      setStatus('Speech could not start.','Check browser audio permissions.');
      handlers.onError?.();
    },
  });
  speechUtterance=utterance;
}
teachingController=new TeachingController({
  speak:(text,handlers)=>speakText(text,handlers),
  stopSpeech:cancelSpeech,
  pauseSpeech:()=>speechProvider.pause(),
  resumeSpeech:()=>speechProvider.resume(),
  showBoard:(boardData,step)=>{
    lessonPlayback={lessonIndex:currentLesson,stepIndex:teachingController.stepIndex};
    if(activePdfTeaching&&teachingController.lesson===activePdfTeaching&&Number.isInteger(step.page))showPdfPage(step.page);
    else drawBoard({...boardData,reveal:step.reveal});
  },
  playGesture:setTeacherAnimation,
  onState:(state,lesson,stepIndex)=>{
    const active=['speaking','paused','waiting','interrupted'].includes(state);
    $('pause-lesson').disabled=state!=='speaking'&&state!=='paused';
    $('pause-lesson').textContent=state==='paused'?'▶ Resume':'Ⅱ Pause';
    $('stop-speaking').disabled=!['speaking','paused'].includes(state);
    $('resume-lesson').hidden=!['interrupted','waiting','stopped'].includes(state);
    $('next-lesson-step').disabled=!active;
    $('repeat-step').disabled=!lesson||state==='idle';
    if(state==='speaking'){
      teacherListening=false;
      lessonPlayback={lessonIndex:currentLesson,stepIndex};
      learningProgress.lessonIndex=currentLesson;learningProgress.stepIndex=stepIndex;
      learningProgress.studied=[...new Set([...learningProgress.studied,currentLesson])];
      saveProgress(learningProgress);
      setStatus(`Concept ${stepIndex+1} of ${lesson.steps.length}: ${lesson.title}`,`Listen to the explanation, then watch the board update.`);
    }else if(state==='paused'){teacherListening=false;setStatus('Lesson paused.','Resume when you are ready.');}
    else if(state==='interrupted'){teacherListening=true;teacherGesture=0;setTeacherAnimation('listening');setStatus('Your teacher is listening.','Ask your question, then resume this step when ready.');}
    else if(state==='waiting'){teacherListening=true;teacherGesture=0;setTeacherAnimation('thinking');setStatus('Your turn to think.','Answer the question, then continue when ready.');}
    else if(state==='complete'){teacherListening=false;teacherGesture=0;lessonPlayback=null;learningProgress.stepIndex=0;saveProgress(learningProgress);setStatus('Explanation complete.','Ask a question or continue to the next concept.');}
    else if(state==='stopped'){teacherListening=false;lessonPlayback=null;setStatus('Lesson stopped.','Resume from the saved step or start again.');}
    else if(state==='error'){teacherListening=false;lessonPlayback=null;setStatus('Speech could not start.','Check browser audio settings, then retry this step.');}
    if(!active&&state==='idle')lessonPlayback=null;
  },
});
function output(html){$('interaction-output').innerHTML=html;}
$('start-lesson').addEventListener('click',()=>{
  if(['interrupted','stopped','waiting'].includes(teachingController.state))teachingController.resume();
  else if(!teachingController.lesson&&learningProgress.stepIndex>0){
    learningProgress.lessonIndex=currentLesson;
    teachingController.start(lessons[currentLesson],currentLesson,learningProgress.stepIndex);
  }
  else showLesson(currentLesson,true);
});
$('next-step').addEventListener('click',()=>showLesson(currentLesson+1,true));
$('pause-lesson').addEventListener('click',()=>{if(teachingController.state==='paused')teachingController.resume();else teachingController.pause();});
$('stop-lesson').addEventListener('click',()=>teachingController.stop());
$('repeat-step').addEventListener('click',()=>teachingController.repeatStep());
$('next-lesson-step').addEventListener('click',()=>teachingController.nextStep());
$('resume-lesson').addEventListener('click',()=>teachingController.resume());
$('stop-speaking').addEventListener('click',()=>{
  if(['speaking','paused'].includes(teachingController.state)){
    if(teachingController.state==='paused')teachingController.resume();
    else teachingController.pause();
    return;
  }
  if(speechProvider.paused){
    speechProvider.resume();teacherSpeaking=true;speechWordStartedAt=performance.now();speechHasBoundaries=false;
    setVoiceButtonLabel("Pause the teacher's voice");
    setStatus('Your teacher is speaking…','Your teacher is reading the response aloud.');
  }else if(speechProvider.speaking){
    speechProvider.pause();teacherSpeaking=false;mouth.scale.y=0.08;
    setVoiceButtonLabel("Resume the teacher's voice");
    setStatus('Voice paused.','Resume whenever you are ready.');
  }
});
$('voice-rate').addEventListener('input',event=>{$('voice-rate-value').textContent=`${Number(event.target.value).toFixed(2)}×`;});
$('ask-question').addEventListener('click',()=>{
  teachingController.interrupt();
  if(pdfPageTexts.length){
    renderPdfQuiz(makeDocumentQuiz(pdfPageTexts,pdfFileName));
    return;
  }
  const q=currentLesson===0
    ?'A neuron receives x₁ = 2 and x₂ = 3. The weights are w₁ = 0.5 and w₂ = 1, with bias b = 0. What is the weighted sum z?'
    :currentLesson===1
      ?'What does ReLU return when its input is −4?'
      :'What are the three main steps in the learning loop?';
  const choices=currentLesson===0?['2','4','5','6.5']:currentLesson===1?['−4','4','0','1']:['Predict, measure error, adjust weights','Delete inputs, reset model, stop','Sort data, draw chart, save file','Increase every weight'];
  const answer=currentLesson===0?1:currentLesson===1?2:0;
  output(`<div class="quiz-prompt"><strong>Quick understanding check</strong><p>${q}</p><div class="quiz-choices">${choices.map((c,i)=>`<button class="choice" data-choice="${i}">${String.fromCharCode(65+i)}. ${c}</button>`).join('')}</div><div class="button-row"><button class="secondary-button" id="answer-by-voice">🎙 Answer by voice</button></div><div id="voice-status" class="quiz-feedback">Choose an answer or use your microphone.</div><div id="quiz-feedback" class="quiz-feedback"></div></div>`);

  function submitChoice(choiceIndex){
    if(document.querySelector('.choice')?.disabled)return;
    lessonPlayback=null;
    const correct=choiceIndex===answer;
    document.querySelectorAll('.choice').forEach(b=>b.disabled=true);
    const resultText=correct
      ?'That is right. Good work! '+(currentLesson===0?'The weighted sum is (0.5 × 2) + (1 × 3) = 4.':currentLesson===1?'ReLU replaces a negative input with zero.':'The model predicts, measures error, and adjusts its weights.')
      :'Not quite. '+(currentLesson===0?'Multiply each input by its weight, then add the results and bias.':currentLesson===1?'Remember: ReLU returns the larger of zero and its input.':'Think about the sequence from making a prediction to correcting it.');
    $('quiz-feedback').textContent=resultText;
    $('quiz-feedback').classList.toggle('good',correct);
    $('voice-status').textContent=correct?'Answer recorded as correct.':'Answer recorded. Review the hint and try this concept again later.';
    learningProgress=recordAttempt(learningProgress,currentLesson,correct,learningProgress.hintsSinceAttempt>0);
    saveProgress(learningProgress);
    const history=learningProgress.attempts;
    localStorage.setItem('tutorQuizHistory',JSON.stringify(history));
    if(speechProvider.supported)speakText(resultText,{onComplete:()=>{
      if(teachingController.state==='interrupted')setStatus('Your teacher is ready for your next question.','Resume the lesson to continue from the same step.');
    }});
  }
  document.querySelectorAll('.choice').forEach(btn=>btn.addEventListener('click',()=>submitChoice(Number(btn.dataset.choice))));
  $('answer-by-voice').addEventListener('click',()=>{
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition){$('voice-status').textContent='Voice recognition is not supported in this browser. Use Chrome or Edge, or choose an answer above.';return;}
    const recognition=new SpeechRecognition();
    recognition.lang='en-US';recognition.interimResults=false;recognition.maxAlternatives=1;
    $('voice-status').textContent='Listening… say your answer clearly.';
    teacherListening=true;teacherGesture=0;setTeacherAnimation('listening');
    setStatus('Your teacher is listening.','Say your answer after the microphone activates.');
    recognition.onstart=()=>{teacherListening=true;};
    recognition.onresult=(event)=>{
      teacherListening=false;setTeacherAnimation('idle');
      const transcript=event.results[0][0].transcript.toLowerCase().trim();
      $('voice-status').textContent=`I heard: “${transcript}”`;
      let spoken=transcript.replace(/[.,!?]/g,' ').replace(/\s+/g,' ');
      const numberWords={zero:'0',one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',nine:'9',ten:'10'};
      Object.entries(numberWords).forEach(([word,digit])=>{spoken=spoken.replace(new RegExp(`\\b${word}\\b`,'g'),digit);});
      let matched=-1;
      if(currentLesson===0){if(/\b4\b/.test(spoken))matched=1;else if(/\b2\b/.test(spoken))matched=0;else if(/\b5\b/.test(spoken))matched=2;else if(/6\.5|six point five/.test(spoken))matched=3;}
      else if(currentLesson===1){if(/\b0\b|zero|nothing/.test(spoken))matched=2;else if(/negative four|minus four|−4/.test(transcript))matched=0;else if(/\b4\b/.test(spoken))matched=1;else if(/\b1\b|one/.test(spoken))matched=3;}
      else if((spoken.includes('predict')&&spoken.includes('measure')&&spoken.includes('adjust'))||(spoken.includes('prediction')&&spoken.includes('error')&&spoken.includes('weight')))matched=0;
      if(matched>=0)submitChoice(matched);
      else $('voice-status').textContent=`I heard “${transcript}”, but could not confidently match it to an option. Please try again or click an answer.`;
    };
    recognition.onerror=(event)=>{teacherListening=false;setTeacherAnimation('idle');$('voice-status').textContent=`Microphone issue (${event.error}). Check microphone permission and try again.`;setStatus('Your teacher is ready.','Check microphone permission, then try again.');};
    recognition.onend=()=>{teacherListening=false;setTeacherAnimation('idle');if($('voice-status')&&$('voice-status').textContent==='Listening… say your answer clearly.')$('voice-status').textContent='I did not catch an answer. Try again.';if(!teacherSpeaking)setStatus('Your teacher is ready.','Choose an answer or try the microphone again.');};
    recognition.start();
  });
});
$('pdf-upload').addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  const loadId=++pdfLoadId;
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){
    $('pdf-status').textContent='Choose a PDF file.';
    event.target.value='';
    return;
  }
  if(file.size>20*1024*1024){
    $('pdf-status').textContent='PDF is larger than 20 MB. Choose a smaller document.';
    event.target.value='';
    return;
  }
  $('pdf-status').textContent='Reading PDF text locally. Questions and source text stay on this device.';
  $('show-pdf-page').disabled=true;
  $('pdf-page').disabled=true;
  try{
    activePdfTeaching=null;
    teachingController.stop();
    pdfDocument?.destroy();
    pdfPageTexts=[];
    pdfFileName=file.name;
    if(!pdfjsLib){
      const [pdfModule,workerModule]=await Promise.all([
        import('pdfjs-dist'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);
      pdfjsLib=pdfModule;
      pdfjsLib.GlobalWorkerOptions.workerSrc=workerModule.default;
    }
    const bytes=await file.arrayBuffer();
    const documentProxy=await pdfjsLib.getDocument({data:bytes}).promise;
    if(loadId!==pdfLoadId){documentProxy.destroy();return;}
    pdfDocument=documentProxy;
    if(documentProxy.numPages>100)throw new Error('This PDF has more than 100 pages. Please choose a smaller section.');
    pdfPageTexts=await extractPdfPageTexts(documentProxy);
    if(loadId!==pdfLoadId)return;
    activePdfTeaching=null;
    $('pdf-page').max=String(documentProxy.numPages);
    $('pdf-page').value='1';
    $('pdf-page').disabled=false;
    $('show-pdf-page').disabled=false;
    $('visual-mode').querySelector('option[value="pdf"]').disabled=false;
    $('visual-mode').value='pdf';
    const documentAnalysis=analyzePdf(pdfPageTexts,pdfFileName);
    $('pdf-status').textContent=`${file.name} loaded locally · ${documentProxy.numPages} pages · ${documentAnalysis.hasText?'text available for rule-based teaching.':'no extractable text; image-only pages cannot be read.'} No PDF text leaves this device.`;
    await showPdfPage(1);
  }catch(error){
    if(loadId!==pdfLoadId)return;
    console.error('PDF could not be read.',error);
    pdfDocument=null;pdfPageTexts=[];
    $('pdf-status').textContent=`Could not read this PDF: ${error.message}`;
  }
});
async function showPdfPage(pageNumber){
  if(!pdfDocument)return;
  const renderId=++pdfRenderId;
  const number=Math.max(1,Math.min(pdfDocument.numPages,Number(pageNumber)||1));
  try{
    const documentProxy=pdfDocument;
    const page=await documentProxy.getPage(number);
    const viewport=page.getViewport({scale:Math.min(1.6,1200/page.getViewport({scale:1}).width)});
    const rendered=document.createElement('canvas');
    rendered.width=Math.ceil(viewport.width);rendered.height=Math.ceil(viewport.height);
    await page.render({canvasContext:rendered.getContext('2d'),viewport}).promise;
    if(renderId!==pdfRenderId||documentProxy!==pdfDocument)return;
    const preview=$('pdf-page-preview');preview.width=rendered.width;preview.height=rendered.height;
    preview.getContext('2d').drawImage(rendered,0,0);preview.hidden=false;
    showPdfOnBoard(rendered,number,pdfFileName);
    $('visual-mode').value='pdf';
    $('pdf-page').value=String(number);
    $('pdf-status').textContent=`Showing page ${number} from ${pdfFileName}. Page text is extracted locally; image-only diagrams are displayed but not interpreted.`;
  }catch(error){
    console.error(`Could not render PDF page ${number}.`,error);
    $('pdf-status').textContent=`Could not render page ${number}: ${error.message}`;
  }
}
$('show-pdf-page').addEventListener('click',()=>showPdfPage($('pdf-page').value));
$('visual-mode').addEventListener('change',event=>{
  if(event.target.value==='pdf'){
    if(pdfDocument)showPdfPage($('pdf-page').value);
    else{$('visual-mode').value='lesson';$('pdf-status').textContent='Upload a PDF before choosing PDF page presentation.';}
  }else{
    drawBoard(lessons[currentLesson].board);
  }
});
$('ask-text-question').addEventListener('click',()=>{
  const question=$('student-question').value.trim();
  if(!question){$('pdf-status').textContent='Type a question for the teacher first.';return;}
  teachingController.interrupt();
  teacherListening=true;teacherGesture=0;setTeacherAnimation('thinking');
  setStatus('Your teacher is thinking…','Searching the uploaded PDF locally using transparent text-matching rules.');
  if(!pdfPageTexts.length){
    const answer='Upload a PDF with selectable text to use local source-based teaching. No external AI service is connected.';
    output(`<div class="memory-card"><strong>Local PDF teaching</strong><p>${answer}</p></div>`);
    teacherListening=false;setTeacherAnimation('idle');
    $('pdf-status').textContent=answer;
    setStatus('No PDF source is loaded.',answer);
    speakText(answer);
    return;
  }
  const response=generateTeachingResponse({pages:pdfPageTexts,fileName:pdfFileName,question});
  presentTutorResponse(response);
  $('pdf-status').textContent=response.available
    ?`Rule-based answer created locally from ${response.sourceReferences.map(source=>`page ${source.page}`).join(', ')}. No document text or question was sent.`
    :response.answer;
  if(response.available){
    startPdfTeaching(response);
  }else{
    teacherListening=false;setTeacherAnimation('speaking');
    speakText(response.answer);
  }
});

function appendSection(container,title,text){
  if(!title&&!text)return;
  const section=document.createElement('section');
  section.className='tutor-report-section';
  if(title){const heading=document.createElement('strong');heading.textContent=title;section.append(heading);}
  if(text){const paragraph=document.createElement('p');paragraph.textContent=text;section.append(paragraph);}
  container.append(section);
}
function appendPageButton(container,page){
  const button=document.createElement('button');
  button.type='button';button.className='source-page-button';
  button.textContent=`Show ${pdfFileName}, page ${page}`;
  button.addEventListener('click',()=>showPdfPage(page));
  container.append(button);
}
function startPdfTeaching(response){
  activePdfTeaching={title:`PDF lesson: ${response.fileName}`,steps:response.steps,board:lessons[currentLesson].board};
  teacherListening=false;teacherGesture=1;
  teachingController.start(activePdfTeaching,currentLesson,0);
}
function presentTutorResponse(response){
  const container=$('interaction-output');container.replaceChildren();
  const label=document.createElement('p');label.className='local-mode-note';
  label.textContent='Rule-based teaching · processed on this device · not generated by AI.';
  container.append(label);
  appendSection(container,'Simple explanation',response.available?response.explanation:response.answer);
  if(response.available){
    const controls=document.createElement('div');controls.className='button-row pdf-teaching-controls';
    const teach=document.createElement('button');teach.type='button';teach.className='secondary-button';teach.textContent='Teach this explanation';
    teach.addEventListener('click',()=>startPdfTeaching(response));controls.append(teach);container.append(controls);
    if(response.points.length){
      const list=document.createElement('ul');list.className='pdf-point-list';
      response.points.forEach(point=>{const item=document.createElement('li');item.textContent=point.text;list.append(item);});
      appendSection(container,'Important points','');container.lastElementChild.append(list);
    }
    if(response.keyTerms.length){
      const list=document.createElement('ul');
      response.keyTerms.forEach(({term,page})=>{const item=document.createElement('li');item.textContent=`${term} — page ${page}`;list.append(item);});
      appendSection(container,'Key terms','');container.lastElementChild.append(list);
    }
    if(response.sections.length){
      const list=document.createElement('ul');
      response.sections.forEach(({title,page})=>{
        const item=document.createElement('li');item.textContent=`${title} — page ${page}`;
        list.append(item);
      });
      appendSection(container,'Document sections','');container.lastElementChild.append(list);
    }
    appendSection(container,'Illustrative example',response.example);
    appendSection(container,'Short summary',response.summary);
    appendSection(container,'Memory aid',response.memoryAid);
    const pages=document.createElement('div');pages.className='source-page-links';
    response.sourceReferences.forEach(source=>appendPageButton(pages,source.page));
    if(pages.childElementCount){const sourceLabel=document.createElement('strong');sourceLabel.textContent=`Source: ${response.fileName}`;container.append(sourceLabel,pages);}
  }
  renderPdfQuiz(response.quiz,container);
}
function renderPdfQuiz(quiz,container=$('interaction-output')){
  if(!quiz.length){
    const note=document.createElement('p');note.className='quiz-feedback';
    note.textContent='The PDF did not contain enough distinct text passages to create source-based quiz questions.';
    container.append(note);return;
  }
  const quizSection=document.createElement('section');quizSection.className='pdf-quiz';
  const heading=document.createElement('strong');heading.textContent=`Source-based quiz (${quiz.length} question${quiz.length===1?'':'s'})`;
  quizSection.append(heading);
  let index=0;
  function showQuestion(){
    if(index>=quiz.length){
      const done=document.createElement('p');done.className='quiz-feedback good';done.textContent='You have completed the questions available from this PDF.';quizSection.append(done);return;
    }
    const item=quiz[index];const card=document.createElement('div');card.className='pdf-quiz-card';
    const prompt=document.createElement('p');prompt.textContent=`${index+1}. ${item.prompt}`;
    const answer=document.createElement('textarea');answer.rows=2;answer.maxLength=1000;answer.placeholder='Write your answer using the PDF…';answer.setAttribute('aria-label',`Answer to question ${index+1}`);
    const feedback=document.createElement('p');feedback.className='quiz-feedback';feedback.setAttribute('aria-live','polite');
    let usedHint=false;
    const buttons=document.createElement('div');buttons.className='button-row';
    const hint=document.createElement('button');hint.type='button';hint.className='secondary-button';hint.textContent='Show hint';
    hint.addEventListener('click',()=>{
      if(usedHint)return;
      usedHint=true;learningProgress=recordHintUse(learningProgress);saveProgress(learningProgress);
      feedback.textContent=item.hint;hint.disabled=true;
    });
    const submit=document.createElement('button');submit.type='button';submit.className='secondary-button';submit.textContent='Check answer';
    submit.addEventListener('click',()=>{
      if(!answer.value.trim()){feedback.textContent='Write an answer before checking it.';return;}
      const result=evaluateQuizAnswer(item,answer.value);
      feedback.classList.toggle('good',result.correct);
      feedback.textContent=`${result.feedback} Source answer: ${item.answer} ${item.explanation}`;
      learningProgress=recordAttempt(learningProgress,currentLesson,result.correct,usedHint);saveProgress(learningProgress);
      localStorage.setItem('tutorQuizHistory',JSON.stringify(learningProgress.attempts));
      submit.disabled=true;answer.disabled=true;
      const sourceButton=document.createElement('button');sourceButton.type='button';sourceButton.className='source-page-button';sourceButton.textContent=`Show page ${item.page}`;
      sourceButton.addEventListener('click',()=>showPdfPage(item.page));card.append(sourceButton);
      const next=document.createElement('button');next.type='button';next.className='secondary-button';next.textContent=index===quiz.length-1?'Finish quiz':'Next question';
      next.addEventListener('click',()=>{index+=1;showQuestion();});buttons.append(next);
    });
    buttons.append(hint,submit);card.append(prompt,answer,buttons,feedback);quizSection.append(card);
  }
  showQuestion();container.append(quizSection);
}
$('memory-aid').addEventListener('click',()=>{
  stopCurrentSpeech();
  learningProgress=recordHintUse(learningProgress);saveProgress(learningProgress);
  if(pdfPageTexts.length){
    const documentAnalysis=analyzePdf(pdfPageTexts,pdfFileName);
    const terms=documentAnalysis.keywords.slice(0,4);
    const memory=terms.length
      ?`Memory aid built from PDF keywords: ${terms.join(' → ')}. These are extracted source words, not a generated factual claim.`
      :'This PDF has no keywords available for a memory aid.';
    output(`<div class="memory-card"><strong>Local memory aid</strong><p>${memory}</p></div>`);
    return;
  }
  const memory=currentLesson===0?'<strong>Memory trick: “Input → Weight → Add → Activate.”</strong><p>Imagine a recipe: inputs are ingredients, weights are their amounts, bias is the extra seasoning, and activation decides the final output.</p>':currentLesson===1?'<strong>Memory trick: “ReLU removes the negative.”</strong><p>Negative number? Output zero. Positive number? Let it pass unchanged.</p>':'<strong>Memory trick: “P-M-A: Predict, Measure, Adjust.”</strong><p>Predict an answer, measure the error, then adjust the weights to improve the next prediction.</p>';
  output(`<div class="memory-card">${memory}</div>`);
});
document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.remove('active'));
  btn.classList.add('active');
  const panel=btn.dataset.panel;
  if(panel==='lesson'){output('Choose an activity and your teacher will guide you.');showLesson(currentLesson,false);}
  if(panel==='questions')$('ask-question').click();
  if(panel==='memory')$('memory-aid').click();
  if(panel==='progress'){
    const correct=learningProgress.attempts.filter(attempt=>attempt.correct).length;
    const rate=learningProgress.attempts.length?Math.round(correct/learningProgress.attempts.length*100):0;
    const lessonHistory=lessons.map((lesson,index)=>{
      const history=estimateMasteryFromHistory(learningProgress,index);
      return `<li>${lesson.title}: ${history.available?`${Math.round(history.accuracy*100)}% observed accuracy across ${history.attempts} attempt(s)`:'no quiz attempts yet'}</li>`;
    }).join('');
    const modelStatus=knowledgeModel.predict({}).then(result=>result.available?'trained student model ready':result.reason);
    modelStatus.then(status=>output(`<strong>Learning progress · local device</strong><p>Concepts studied: ${learningProgress.studied.length} of ${lessons.length}. Quiz attempts: ${learningProgress.attempts.length}. Correct answers: ${correct} (${rate}%). Memory-aid uses: ${learningProgress.hintUses||0}.</p><ul>${lessonHistory}</ul><p>Observed accuracy is descriptive history, not a mastery prediction. ${status}</p>`));
  }
}));

// Responsive rendering and gentle idle animation.
const clock=new THREE.Clock();
function resize(){const w=container.clientWidth,h=container.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));}
const observer=new ResizeObserver(resize);observer.observe(container);
function animate(){
  requestAnimationFrame(animate);
  const delta=clock.getDelta();
  const t=clock.elapsedTime;
  teacherMixer?.update(delta);
  teacher.position.y=Math.sin(t*1.5)*0.012;
  head.rotation.y=teacherListening?Math.sin(t*1.5)*0.018:teacherSpeaking?0.07+Math.sin(t*0.7)*0.045:Math.sin(t*0.6)*0.035;
  head.rotation.x=teacherListening?0.055+Math.sin(t*2)*0.012:Math.sin(t*0.8)*0.015;
  const blinkPhase=(t+0.3)%4.2;
  const blink=blinkPhase<0.14?Math.sin(Math.PI*blinkPhase/0.14):0;
  eyes.forEach(({whiteEye,iris,pupil})=>{
    whiteEye.scale.y=0.78*(1-blink*0.94);
    iris.scale.y=1-blink*0.94;
    pupil.scale.y=1-blink*0.94;
  });
  teacherBlinkMorphs.forEach(({mesh,index})=>{mesh.morphTargetInfluences[index]=blink;});
  const gesture=teacherGesture?1:0;
  pointingArm.rotation.z=(teacherSpeaking?Math.sin(t*3.8)*0.055:Math.sin(t*0.9)*0.018)+(gesture?Math.sin(t*2.2)*0.025:0);
  pointingArm.rotation.x=teacherSpeaking?Math.sin(t*2.5)*0.035:0;
  restingArm.rotation.z=teacherSpeaking?Math.sin(t*2.6)*0.045:Math.sin(t*0.7)*0.01;
  const elapsed=performance.now()-speechWordStartedAt;
  const wordPhase=speechHasBoundaries?Math.min(1,elapsed/speechWordDuration):((t*2.2)%1);
  const speakingMouth=teacherSpeaking?(0.08+Math.pow(Math.max(0,Math.sin(wordPhase*Math.PI*speechWordSyllables)),0.7)*0.72):0.08;
  mouth.scale.y=speakingMouth;
  const mouthOpen=Math.max(0,(speakingMouth-0.08)/0.72);
  teacherMouthMorphs.forEach(({mesh,index})=>{mesh.morphTargetInfluences[index]=mouthOpen;});
  if(teacherJawBone)teacherJawBone.rotation.x=teacherJawBaseRotation-mouthOpen*0.18;
  teacherHalo.material.emissiveIntensity=0.3+Math.sin(t*2)*0.12;
  const target=new THREE.Vector3(0,2.05,0);
  camera.position.x=Math.sin(yaw)*cameraDistance;
  camera.position.z=Math.cos(yaw)*cameraDistance;
  camera.position.y=3.25+pitch*4;
  camera.lookAt(target);
  renderer.render(scene,camera);
}
showLesson(0,false);animate();
