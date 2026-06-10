import {
  BufferGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Scene,
  SphereGeometry,
  Timer,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

import {
  ANTENNA_HEIGHT,
  ANTENNA_SPREAD,
  BOLT_LENGTH,
  BOLT_REFRESH_SEC,
  BOLTS_PER_ANTENNA,
  BOUNDS,
  COLORS,
  CONNECTION_DISTANCE,
  PARTICLE_COUNT,
  PARTICLE_SHADES,
  ROTATION_SPEED_X,
  ROTATION_SPEED_Y,
  SEGMENTS_PER_BOLT,
  TIP_RADIUS,
  TV_CORNER_RADIUS,
  TV_DEPTH,
  TV_HEIGHT,
  TV_WIDTH,
} from './constants'

/**
 * Handle returned by {@link createSplashScene} for controlling the 3D scene
 * from the caller side.
 */
export interface SplashSceneHandle {
  dispose(): void
  resize(width: number, height: number): void
}

/**
 * Creates the full 3D splash scene on the given canvas element.
 *
 * The scene consists of:
 * - A cloud of colored particles connected by proximity lines.
 * - A rounded-box "TV" shape with curved antennae and tip spheres.
 * - Lightning bolts that periodically regenerate from each antenna tip.
 * - Continuous rotation, hover, glow-pulse, and flicker animations.
 *
 * The function starts the render loop immediately and listens for window
 * resize events. Call `dispose()` on the returned handle to stop rendering
 * and free all GPU resources.
 *
 * @param canvas - The `<canvas>` element to render into.
 * @returns A handle with `dispose()` and `resize()` methods.
 */
export function createSplashScene(
  canvas: HTMLCanvasElement,
): SplashSceneHandle {
  const width = canvas.clientWidth || window.innerWidth
  const height = canvas.clientHeight || window.innerHeight

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  })
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(COLORS.background)

  const scene = new Scene()
  const camera = new PerspectiveCamera(60, width / height, 0.1, 1000)
  camera.position.z = 24

  // ── Particles ──
  const positions = new Float32Array(PARTICLE_COUNT * 3)
  const pColors = new Float32Array(PARTICLE_COUNT * 3)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const i3 = i * 3
    positions[i3] = (Math.random() - 0.5) * BOUNDS * 2
    positions[i3 + 1] = (Math.random() - 0.5) * BOUNDS * 2
    positions[i3 + 2] = (Math.random() - 0.5) * BOUNDS * 2
    const shade =
      PARTICLE_SHADES[Math.floor(Math.random() * PARTICLE_SHADES.length)]
    pColors[i3] = shade[0]
    pColors[i3 + 1] = shade[1]
    pColors[i3 + 2] = shade[2]
  }

  const pointsGeo = new BufferGeometry()
  pointsGeo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  pointsGeo.setAttribute('color', new Float32BufferAttribute(pColors, 3))
  const pointsMat = new PointsMaterial({
    size: 0.15,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true,
    vertexColors: true,
  })
  const points = new Points(pointsGeo, pointsMat)

  // ── Connection lines ──
  const lineVerts: number[] = []
  const lineColors: number[] = []
  const threshold2 = CONNECTION_DISTANCE ** 2

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    for (let j = i + 1; j < PARTICLE_COUNT; j++) {
      const dx = positions[i * 3] - positions[j * 3]
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1]
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2]
      if (dx * dx + dy * dy + dz * dz < threshold2) {
        lineVerts.push(
          positions[i * 3],
          positions[i * 3 + 1],
          positions[i * 3 + 2],
          positions[j * 3],
          positions[j * 3 + 1],
          positions[j * 3 + 2],
        )
        lineColors.push(
          pColors[i * 3],
          pColors[i * 3 + 1],
          pColors[i * 3 + 2],
          pColors[j * 3],
          pColors[j * 3 + 1],
          pColors[j * 3 + 2],
        )
      }
    }
  }

  const lineGeo = new BufferGeometry()
  lineGeo.setAttribute('position', new Float32BufferAttribute(lineVerts, 3))
  lineGeo.setAttribute('color', new Float32BufferAttribute(lineColors, 3))
  const lineMat = new LineBasicMaterial({
    transparent: true,
    opacity: 0.15,
    vertexColors: true,
  })
  const lines = new LineSegments(lineGeo, lineMat)

  // ── Little TV shape ──
  const topY = TV_HEIGHT / 2

  // Rounded body - pink filled mesh
  const bodyGeo = new RoundedBoxGeometry(
    TV_WIDTH,
    TV_HEIGHT,
    TV_DEPTH,
    4,
    TV_CORNER_RADIUS,
  )
  const bodyMat = new MeshBasicMaterial({
    color: COLORS.tvBody,
    transparent: true,
    opacity: 0.15,
    side: DoubleSide,
  })
  const bodyMesh = new Mesh(bodyGeo, bodyMat)

  // Edge outline
  const edgesGeo = new EdgesGeometry(bodyGeo, 15)
  const edgeMat = new LineBasicMaterial({
    color: COLORS.tvEdge,
    transparent: true,
    opacity: 0.6,
  })
  const edges = new LineSegments(edgesGeo, edgeMat)

  // Screen overlay (blue tint on front face)
  const screenGeo = new RoundedBoxGeometry(
    TV_WIDTH - 1.2,
    TV_HEIGHT - 1.2,
    0.05,
    3,
    0.4,
  )
  const screenMat = new MeshBasicMaterial({
    color: COLORS.tvScreen,
    transparent: true,
    opacity: 0.1,
    side: DoubleSide,
  })
  const screenMesh = new Mesh(screenGeo, screenMat)
  screenMesh.position.z = TV_DEPTH / 2 + 0.02

  // Curved antennae (TubeGeometry for thickness)
  const antMat = new MeshBasicMaterial({
    color: COLORS.tvBody,
    transparent: true,
    opacity: 0.6,
  })
  const leftCurve = new QuadraticBezierCurve3(
    new Vector3(-ANTENNA_SPREAD, topY, 0),
    new Vector3(-(ANTENNA_SPREAD + 0.8), topY + ANTENNA_HEIGHT * 0.6, 0.3),
    new Vector3(-(ANTENNA_SPREAD + 0.5), topY + ANTENNA_HEIGHT, 0),
  )
  const rightCurve = new QuadraticBezierCurve3(
    new Vector3(ANTENNA_SPREAD, topY, 0),
    new Vector3(ANTENNA_SPREAD + 0.8, topY + ANTENNA_HEIGHT * 0.6, 0.3),
    new Vector3(ANTENNA_SPREAD + 0.5, topY + ANTENNA_HEIGHT, 0),
  )
  const leftAntGeo = new TubeGeometry(leftCurve, 12, 0.08, 8, false)
  const rightAntGeo = new TubeGeometry(rightCurve, 12, 0.08, 8, false)
  const leftAnt = new Mesh(leftAntGeo, antMat)
  const rightAnt = new Mesh(rightAntGeo, antMat)

  // Antenna tip spheres (pink accent)
  const tipGeo = new SphereGeometry(TIP_RADIUS, 12, 12)
  const tipMat = new MeshBasicMaterial({
    color: COLORS.tipAccent,
    transparent: true,
    opacity: 0.6,
  })
  const leftTipPos: [number, number, number] = [
    -(ANTENNA_SPREAD + 0.5),
    topY + ANTENNA_HEIGHT,
    0,
  ]
  const rightTipPos: [number, number, number] = [
    ANTENNA_SPREAD + 0.5,
    topY + ANTENNA_HEIGHT,
    0,
  ]
  const leftTip = new Mesh(tipGeo, tipMat)
  leftTip.position.set(...leftTipPos)
  const rightTip = new Mesh(tipGeo, tipMat)
  rightTip.position.set(...rightTipPos)

  // ── Lightning bolts ──
  const totalBolts = BOLTS_PER_ANTENNA * 2
  const vertsPerBolt = SEGMENTS_PER_BOLT * 2
  const lightningArr = new Float32Array(totalBolts * vertsPerBolt * 3)
  const lightningGeo = new BufferGeometry()
  lightningGeo.setAttribute(
    'position',
    new Float32BufferAttribute(lightningArr, 3),
  )
  const lightningMat = new LineBasicMaterial({
    color: COLORS.lightning,
    transparent: true,
    opacity: 0.8,
  })
  const lightning = new LineSegments(lightningGeo, lightningMat)

  /** Regenerates random vertex positions for every lightning bolt. */
  function updateLightning() {
    for (let b = 0; b < totalBolts; b++) {
      const isLeft = b < BOLTS_PER_ANTENNA
      const tip = isLeft ? leftTipPos : rightTipPos
      const baseIdx = b * vertsPerBolt * 3

      let cx = tip[0],
        cy = tip[1],
        cz = tip[2]
      const segLen = BOLT_LENGTH / SEGMENTS_PER_BOLT

      for (let s = 0; s < SEGMENTS_PER_BOLT; s++) {
        const si = baseIdx + s * 6
        lightningArr[si] = cx
        lightningArr[si + 1] = cy
        lightningArr[si + 2] = cz

        const outward = (Math.random() - 0.5) * 2.0
        const upward = 0.5 + Math.random() * 0.8
        const depth = (Math.random() - 0.5) * 0.8

        cx += outward * segLen * 0.5
        cy += upward * segLen * 0.4
        cz += depth * segLen * 0.3

        lightningArr[si + 3] = cx
        lightningArr[si + 4] = cy
        lightningArr[si + 5] = cz
      }
    }
    ;(lightningGeo.attributes.position as Float32BufferAttribute).needsUpdate =
      true
  }

  // ── Assemble scene ──
  const tvGroup = new Group()
  tvGroup.add(
    bodyMesh,
    edges,
    screenMesh,
    leftAnt,
    rightAnt,
    leftTip,
    rightTip,
    lightning,
  )

  const group = new Group()
  group.add(points, lines, tvGroup)
  scene.add(group)

  updateLightning()

  const timer = new Timer()
  let frameId = 0
  let lastBoltUpdate = 0

  /** Main render loop driven by `requestAnimationFrame`. */
  function animate() {
    frameId = requestAnimationFrame(animate)
    timer.update()
    const elapsed = timer.getElapsed()
    group.rotation.y = elapsed * ROTATION_SPEED_Y
    group.rotation.x = elapsed * ROTATION_SPEED_X

    // Hover animation
    tvGroup.position.y = Math.sin(elapsed * 0.8) * 0.3

    // Pulse TV body glow
    const glow = 0.12 + 0.08 * Math.sin(elapsed * 1.5)
    bodyMat.opacity = glow
    edgeMat.opacity = 0.5 + 0.2 * Math.sin(elapsed * 2)

    // Antenna tip pulse - peak flashes white
    const tipGlow = 0.4 + 0.5 * Math.sin(elapsed * 3)
    tipMat.opacity = tipGlow
    tipMat.color.setHex(tipGlow > 0.8 ? 0xffffff : COLORS.tipAccent)

    // Lightning flicker
    const flicker = Math.random() > 0.15 ? 0.7 + Math.random() * 0.3 : 0.1
    lightningMat.opacity = flicker

    // Refresh lightning positions
    if (elapsed - lastBoltUpdate > BOLT_REFRESH_SEC) {
      updateLightning()
      lastBoltUpdate = elapsed
    }

    renderer.render(scene, camera)
  }

  /** Updates the renderer size and camera aspect ratio. */
  function handleResize(w: number, h: number) {
    if (w === 0 || h === 0) return
    renderer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function onResize() {
    handleResize(canvas.clientWidth, canvas.clientHeight)
  }

  window.addEventListener('resize', onResize)
  animate()

  return {
    dispose() {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', onResize)
      pointsGeo.dispose()
      pointsMat.dispose()
      lineGeo.dispose()
      lineMat.dispose()
      bodyGeo.dispose()
      bodyMat.dispose()
      edgesGeo.dispose()
      edgeMat.dispose()
      screenGeo.dispose()
      screenMat.dispose()
      leftAntGeo.dispose()
      rightAntGeo.dispose()
      antMat.dispose()
      tipGeo.dispose()
      tipMat.dispose()
      lightningGeo.dispose()
      lightningMat.dispose()
      renderer.dispose()
    },
    resize: handleResize,
  }
}
