import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei/web/Html'
import { useHtmlPortal } from './useHtmlPortal'
import { OrbitControls } from '@react-three/drei/core/OrbitControls'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pickLine } from './slang'
import { endTurn, joinChatter, lineSeed, nextSpeaker, useChatter } from './chatter'
import { employeeFor, managerOf, useOrg, type Employee } from './org'
import { OrgPanel } from './OrgPanel'
import { type CrewMember } from './crew'
import { lanesFrom } from './lanes'
import { ProjectOffices } from './ProjectOffices'
import { VOID_GAP, deskPlatform, officeFloor, platformFor, projectPlatforms, projectTeams } from './projectOffice'
import { bullpen } from './floorplan'
import { useReducedMotion } from 'framer-motion'
import * as THREE from 'three'
import { create } from 'zustand'
import type { OfficeWorker } from '@/api/backend'
import { deskCommandsFor } from './deskCommands'

const BOX = new THREE.BoxGeometry(1, 1, 1)
const MATERIALS = new Map<string, THREE.MeshLambertMaterial>()
function material(color: string) {
  if (!MATERIALS.has(color)) MATERIALS.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }))
  return MATERIALS.get(color)!
}
// PERF: no castShadow/receiveShadow. A shadow map renders every caster a second time, and this
// room is ~570 separate boxes, so shadows were exactly doubling the frame's draw calls (measured:
// 1130 -> 574). The city made the same call long ago — see CityCanvas, "No real-time shadows" —
// and fakes contact with a dark quad instead. Flat shading plus a low fill light carries the form.
function Block({ position, size, color }: { position: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh geometry={BOX} material={material(color)} position={position} scale={size} />
}

// Cubicle screens and the trim that caps them, shared by the open-plan desks and the rooms.
const PARTITION = '#8e82a8'
const ROOM_TRIM = '#b6a899'

/**
 * Frames the floor, but never zooms out past the point where an office is readable.
 *
 * It used to fit the whole floor, so every project added shrank all of them — at six platforms
 * the desks were specks. `readable` is the span of one platform and its gap, and the camera stops
 * widening there; past it the floor is bigger than the frame on purpose and the player pans to
 * reach the rest.
 */
function Camera({ width, depth, readable }: { width: number; depth: number; readable: number }) {
  const { camera, size } = useThree()
  useLayoutEffect(() => {
    camera.position.set(18, 18, 18)
    camera.lookAt(0, 0.7, 0)
    if (camera instanceof THREE.OrthographicCamera) {
      const span = Math.min(width + depth, readable)
      camera.zoom = Math.min(size.width / (span * 0.72), size.height / (span * 0.42 + 4)) * 0.88
      camera.updateProjectionMatrix()
    }
  }, [camera, size.width, size.height, width, depth, readable])
  return null
}

// One speaker in the whole room at a time: a new bubble every 5s, visible ~3.5s. The turn itself
// lives in `chatter.ts`, which is where the one-voice rule is enforced and tested.
function ChatterClock() {
  useEffect(() => {
    let hide: ReturnType<typeof setTimeout>
    const next = () => {
      if (!nextSpeaker()) return
      clearTimeout(hide)
      hide = setTimeout(endTurn, 3500)
    }
    const first = setTimeout(next, 1200)
    const id = setInterval(next, 5000)
    return () => { clearTimeout(first); clearInterval(id); clearTimeout(hide) }
  }, [])
  return null
}

function SpeechBubble({ id }: { id: string }) {
  // The turn is keyed on this rendered person, not on their id: if the same employee were ever
  // drawn twice — seated in their room and again at a desk — they still could not talk over
  // themselves. The id only decides which line they tell.
  const voice = useId()
  useEffect(() => joinChatter(voice), [voice])
  const speaking = useChatter((s) => s.speaker === voice)
  const tick = useChatter((s) => s.tick)
  const portal = useHtmlPortal()
  if (!speaking) return null
  return <Html portal={portal} position={[0, 1.9, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
    <div style={{ background: 'var(--gg-night)', color: 'var(--gg-ink)', border: '2px solid var(--gg-haze)', boxShadow: '3px 3px 0 rgba(0,0,0,0.6)', padding: '4px 8px', font: "8px/1.3 'Press Start 2P', monospace", whiteSpace: 'nowrap', transform: 'translateY(-60%)' }}>
      {pickLine(lineSeed(id), tick)}
    </div>
  </Html>
}

// ---- drag employees between offices in 3D ----
interface Drag { emp: Employee; color: string; start: [number, number]; pos: [number, number]; moved: boolean }
const useDrag = create<{ drag: Drag | null }>(() => ({ drag: null }))

function DragGhost() {
  const drag = useDrag((s) => s.drag)
  const portal = useHtmlPortal()
  if (!drag || !drag.moved) return null
  return <group position={[drag.pos[0], 0.9, drag.pos[1]]}>
    <Person color={drag.color} />
    <Html portal={portal} position={[0, 2.1, 0]} center zIndexRange={[12, 0]} style={{ pointerEvents: 'none' }}>
      <div style={{ font: "8px 'Press Start 2P', monospace", background: 'var(--gg-yellow)', color: 'var(--gg-void)', border: '2px solid var(--gg-void)', padding: '2px 5px', whiteSpace: 'nowrap' }}>✋ {drag.emp.name}</div>
    </Html>
  </group>
}

function DragFloor({ width, depth, pods, onTap }: {
  width: number; depth: number
  pods: { id: string; x: number; z: number; w: number; d: number }[]
  /** A press that never moved is a click on that person: select them. */
  onTap: (id: string) => void
}) {
  const end = () => {
    const d = useDrag.getState().drag
    useDrag.setState({ drag: null })
    document.body.style.cursor = ''
    if (!d) return
    // Carrying somebody needs the whole pointer press, so a person in a room cannot also have an
    // onClick: a tap ends here instead. It used to call `useOrg.pick`, which nothing read — so
    // clicking an employee did nothing at all, however many times you clicked.
    if (!d.moved) { onTap(d.emp.id); return }
    // A drop in the corridor between rooms hits nothing, and nobody moves.
    const target = pods.find((p) => Math.abs(d.pos[0] - p.x) < p.w / 2 && Math.abs(d.pos[1] - p.z) < p.d / 2)
    if (!target || target.id === d.emp.officeId) return
    // A room is a project now, so carrying someone into one is the same act as dragging their
    // card into that lane on the staffing board: it writes the one assignment both views read.
    useOrg.getState().assignTo(d.emp.id, target.id)
  }
  useEffect(() => { window.addEventListener('pointerup', end); return () => window.removeEventListener('pointerup', end) })
  return <mesh rotation-x={-Math.PI / 2} position={[0, 0.9, 0]}
    onPointerMove={(e) => {
      const d = useDrag.getState().drag
      if (!d) return
      const pos: [number, number] = [e.point.x, e.point.z]
      const moved = d.moved || Math.hypot(pos[0] - d.start[0], pos[1] - d.start[1]) > 0.35
      useDrag.setState({ drag: { ...d, pos, moved } })
    }}>
    <planeGeometry args={[width * 3, depth * 3]} />
    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
  </mesh>
}

// The same three role colours the staffing board and the org chart use.
const TAG: Record<string, string> = { Manager: 'var(--gg-pink)', 'Team Lead': 'var(--gg-yellow)', Engineer: 'var(--gg-cyan)' }
// Rank only. The tag used to carry the person's project under it, which was worth saying while a
// room held a whole org-chart team: you could not otherwise tell what anyone was working on. A
// room is a project now, and `projectTeams` groups people by lane, so everybody under one roof is
// on that roof's project by construction — the chip could never read anything but the nameplate
// over the door, and nine desks in one room stacked nine copies of it into an unreadable pile.
function RoleTag({ emp }: { emp: Employee }) {
  const portal = useHtmlPortal()
  return <Html portal={portal} position={[0, 1.5, 0]} center zIndexRange={[9, 0]} style={{ pointerEvents: 'none' }}>
    <div style={{ font: "8px/1.3 'Press Start 2P', monospace", textAlign: 'center', whiteSpace: 'nowrap' }}>
      <span style={{ background: TAG[emp.role], color: 'var(--gg-void)', padding: '1px 4px' }}>{emp.role === 'Manager' ? 'MGR' : emp.role === 'Team Lead' ? 'LEAD' : 'ENG'}</span>
    </div>
  </Html>
}

function Person({ color, host = false, typing = false, chatterId, emp, onPick }: {
  color: string; host?: boolean; typing?: boolean; chatterId?: string; emp?: Employee
  /** Selects this person. Rooms' people are dragged instead, and tap-select ends in DragFloor. */
  onPick?: (id: string) => void
}) {
  const hands = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const reduce = useReducedMotion()
  useFrame(({ clock }) => {
    if (!typing || reduce) return
    const tick = Math.floor(clock.elapsedTime * 8)
    if (hands.current) hands.current.rotation.x = tick % 2 ? 0.12 : -0.08
    if (head.current) head.current.rotation.z = Math.sin(Math.floor(tick / 4) * 0.6) * 0.06
  })
  const draggingMe = useDrag((s) => s.drag?.moved && s.drag.emp.id === emp?.id)
  return <group visible={!draggingMe} position={[0, host ? 0 : 0.1, 0]}
    onPointerDown={emp?.officeId ? (e) => { e.stopPropagation(); document.body.style.cursor = 'grabbing'; useDrag.setState({ drag: { emp, color, start: [e.point.x, e.point.z], pos: [e.point.x, e.point.z], moved: false } }) } : undefined}
    onClick={emp && !emp.officeId && onPick ? (e) => { e.stopPropagation(); onPick(emp.id) } : undefined}
    onPointerOver={emp ? () => (document.body.style.cursor = emp.officeId ? 'grab' : 'pointer') : undefined} onPointerOut={emp ? () => (document.body.style.cursor = '') : undefined}>
    {chatterId !== undefined && <SpeechBubble id={chatterId} />}
    {emp && <RoleTag emp={emp} />}
    <Block color="#3f3655" position={[-0.14, 0.22, 0]} size={[0.22, 0.4, 0.24]} />
    <Block color="#3f3655" position={[0.14, 0.22, 0]} size={[0.22, 0.4, 0.24]} />
    <Block color="#211b31" position={[-0.14, 0.08, 0.06]} size={[0.26, 0.12, 0.36]} />
    <Block color="#211b31" position={[0.14, 0.08, 0.06]} size={[0.26, 0.12, 0.36]} />
    <Block color={color} position={[0, 0.62, 0]} size={[0.52, 0.48, 0.32]} />
    <Block color={color} position={[-0.34, 0.62, 0.05]} size={[0.18, 0.36, 0.24]} />
    <Block color={color} position={[0.34, 0.62, 0.05]} size={[0.18, 0.36, 0.24]} />
    <group ref={hands} position={[0, 0.62, 0.12]}>
      <Block color="#ffd0a9" position={[-0.3, 0, 0.12]} size={[0.16, 0.12, 0.28]} />
      <Block color="#ffd0a9" position={[0.3, 0, 0.12]} size={[0.16, 0.12, 0.28]} />
    </group>
    <group ref={head} position={[0, 1.02, 0]}>
      <Block color="#ffd0a9" position={[0, 0, 0]} size={[0.46, 0.42, 0.4]} />
      <Block color={host ? '#c38a63' : '#563b47'} position={[0, 0.22, -0.02]} size={[0.5, 0.16, 0.44]} />
      <Block color="#241b30" position={[-0.1, 0.02, 0.21]} size={[0.06, 0.06, 0.02]} />
      <Block color="#241b30" position={[0.1, 0.02, 0.21]} size={[0.06, 0.06, 0.02]} />
      <Block color="#db8c86" position={[0, -0.08, 0.21]} size={[0.1, 0.04, 0.02]} />
    </group>
  </group>
}

const SCREEN = new THREE.PlaneGeometry(1, 1)
function TerminalScreen({ worker, accent }: { worker: OfficeWorker; accent: string }) {
  const reduce = useReducedMotion()
  const screen = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 80
    const texture = new THREE.CanvasTexture(canvas)
    texture.magFilter = texture.minFilter = THREE.NearestFilter
    texture.generateMipmaps = false
    texture.colorSpace = THREE.SRGBColorSpace
    const mat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    return { canvas, texture, mat, phase: -1, blink: -1 }
  }, [])
  useEffect(() => () => { screen.texture.dispose(); screen.mat.dispose() }, [screen])
  const offset = useMemo(() => [...worker.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 6, [worker.id])
  useFrame(({ clock }) => {
    const phase = reduce ? 0 : (Math.floor(clock.elapsedTime / 1.8) + offset) % 6
    const blink = reduce ? 1 : Math.floor(clock.elapsedTime * 2) % 2
    if (screen.phase === phase && screen.blink === blink) return
    screen.phase = phase; screen.blink = blink
    const context = screen.canvas.getContext('2d')!
    context.fillStyle = '#10282b'; context.fillRect(0, 0, 128, 80)
    context.font = '12px monospace'
    const commands = deskCommandsFor(worker.runtime)
    for (let row = 0; row < 4; row++) {
      context.fillStyle = row === 3 ? accent : '#87b6a5'
      context.fillText(commands[(phase + row + 3) % commands.length].replace('…', '...'), 5, 14 + row * 16)
    }
    if (blink) { context.fillStyle = accent; context.fillRect(5, 72, 8, 3) }
    screen.texture.needsUpdate = true
  })
  return <mesh geometry={SCREEN} material={screen.mat} position={[0, 1.48, -0.405]} scale={[0.82, 0.48, 1]} />
}

function Plant({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    <Block color="#c38275" position={[0, 0.24, 0]} size={[0.48, 0.48, 0.48]} />
    <Block color="#537c59" position={[0, 0.65, 0]} size={[0.1, 0.65, 0.1]} />
    <Block color="#81b38a" position={[-0.18, 0.9, 0]} size={[0.4, 0.26, 0.3]} />
    <Block color="#6d9d79" position={[0.16, 0.76, 0.1]} size={[0.4, 0.26, 0.3]} />
    <Block color="#9ac196" position={[0, 1.1, -0.12]} size={[0.3, 0.3, 0.3]} />
  </group>
}

function Desk({ worker, x, z, selected, accent, onSelect, emp }: {
  worker?: OfficeWorker; x: number; z: number; selected: boolean; accent: string; onSelect: (id: string) => void; emp?: Employee
}) {
  const screen = worker ? worker.runtime.includes('browser') ? '#9bc6d0' : accent : '#433a59'
  return <group position={[x, 0, z]} onClick={(event) => { if (worker) { event.stopPropagation(); onSelect(worker.id) } }}>
    {selected && <Block color={accent} position={[0, 0.04, 0.1]} size={[2.7, 0.05, 2.4]} />}
    {/* Screens on the two faces the camera never looks through, so the bullpen reads as cubicles
        against the walled rooms behind it. */}
    <Block color={PARTITION} position={[0, 0.66, -0.86]} size={[2.6, 1.32, 0.1]} />
    <Block color={ROOM_TRIM} position={[0, 1.35, -0.86]} size={[2.64, 0.07, 0.16]} />
    <Block color={PARTITION} position={[-1.3, 0.6, -0.3]} size={[0.1, 1.2, 1.2]} />
    <Block color="#b89083" position={[0, 1, -0.25]} size={[2.2, 0.18, 1.1]} />
    {[-0.86, 0.86].map((x) => <Block key={x} color="#72566d" position={[x, 0.48, -0.25]} size={[0.16, 0.96, 0.7]} />)}
    <Block color="#59506c" position={[0, 1.48, -0.53]} size={[0.96, 0.62, 0.14]} />
    <Block color="#132c30" position={[0, 1.48, -0.44]} size={[0.82, 0.48, 0.04]} />
    {!worker && [0, 1, 2].map((line) => <Block key={line} color={screen} position={[-0.08 + line * 0.05, 1.59 - line * 0.12, -0.41]} size={[0.5 - line * 0.08, 0.04, 0.02]} />)}
    {worker && <TerminalScreen worker={worker} accent={accent} />}
    <Block color="#59506c" position={[0, 1.17, -0.53]} size={[0.12, 0.24, 0.12]} />
    <Block color="#d6c4c5" position={[0, 1.13, 0.01]} size={[0.66, 0.05, 0.26]} />
    <Block color="#e4d9b7" position={[0.78, 1.18, -0.18]} size={[0.18, 0.22, 0.18]} />
    <Block color="#706389" position={[0, 0.4, 0.8]} size={[0.64, 0.16, 0.64]} />
    <Block color="#706389" position={[0, 0.71, 1.04]} size={[0.64, 0.58, 0.16]} />
    <Block color="#3e344f" position={[0, 0.2, 0.8]} size={[0.12, 0.4, 0.12]} />
    {worker && <group position={[0, 0.18, 0.66]} rotation-y={-Math.PI / 4}>
      <Person color={accent} typing emp={emp} chatterId={worker.id} onPick={() => onSelect(worker.id)} />
    </group>}
  </group>
}

// ---- offices ----------------------------------------------------------------------------------
// Each org-chart office is a room of its own, not a cell in one big grid of cubicles: rooms stand
// apart with a corridor between them, and the workspaces inside are sized by rank — the manager
// gets a glazed private office, every team lead a wide corner cubicle with a return desk and two
// screens, engineers a standard one they can see over.
//
// The camera only ever orbits the +x/+z quadrant (see DragAwareOrbit's azimuth limits), so each
// room keeps its two far walls full height and its two near walls knee high: a doll-house cutaway,
// rather than a room that hides its own desks behind its own glass.



/**
 * Dragging empty floor moves the view; dragging a person moves the person.
 *
 * Left-drag pans rather than orbits, because the azimuth is clamped to a narrow window anyway —
 * there is almost no orbit to spend the main gesture on, and the floor is now wider than the
 * frame, so panning is how you reach the next office. Rotation stays on the right button and on
 * a two-finger drag. The whole control is switched off while someone is being carried, so the
 * view does not slide out from under the drop.
 */
function DragAwareOrbit(props: React.ComponentProps<typeof OrbitControls>) {
  const dragging = useDrag((s) => !!s.drag)
  return <OrbitControls
    {...props}
    enabled={!dragging}
    enablePan
    screenSpacePanning
    mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
    touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
  />
}

export function OfficeRoom3D({ workers, accent, selected, onSelect, crew, streams = [] }: { workers: OfficeWorker[]; accent: string; selected: string | null; onSelect: (id: string) => void; buildingId?: string; crew?: Map<string, CrewMember>; streams?: { id: string; name: string }[] }) {
  // PERF: a hidden tab was still rendering this room every frame. Same guard as CityCanvas.
  const [visible, setVisible] = useState(() => !document.hidden)
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  const desks = bullpen(workers.length)
  const roomName = workers[0]?.buildingId ?? decodeURIComponent(location.pathname.split('/').pop() ?? 'office')
  const mgr = managerOf(roomName)
  // One lane list for the whole room, from the same inputs the staffing board uses, so a tag over
  // someone's head names the project their card sits in.
  const projects = useOrg((state) => state.projects)
  const assign = useOrg((state) => state.assign)
  const lanes = useMemo(() => lanesFrom([...(crew?.values() ?? [])], projects, streams), [crew, projects, streams])
  // Each project is a room of its own, holding exactly the people its lane holds on the staffing
  // board. Benched people have no project, so they have no room — they stand at the terminal desks.
  const teams = useMemo(
    // roleKind and managerId travel with the person: without the kind a custom role lands in a
    // cubicle whatever it does in a run, and without the manager an intern has no desk to sit at.
    () => projectTeams(
      [...(crew?.values() ?? [])].map((m) => ({
        id: m.id, name: m.name, role: m.role, roleKind: m.roleKind, managerId: m.managerId, source: m.source, cwd: m.cwd,
      })),
      assign,
      lanes,
    ),
    [crew, assign, lanes],
  )
  const floor = useMemo(() => officeFloor(teams, desks), [teams, desks])
  const deck = deskPlatform(floor)
  // One platform and its gap: the widest the camera will pull back to before the player pans.
  const slab = platformFor(floor.room)
  const readable = slab.w + slab.d + VOID_GAP * 2
  const { width, depth } = floor
  // The roster owns names and roles, so the tag over a desk matches its card on the staffing board.
  const emps = workers.map((w, i) => {
    const base = employeeFor(roomName, w, i, desks.columns)
    const member = crew?.get(w.id)
    return member ? { ...base, name: member.name, role: member.role } : base
  })
  const nameOf = (id?: string) => id === mgr.id ? mgr.name : id?.startsWith('lead:') ? (emps[Number(id.split(':').pop())]?.name ?? 'Team Lead') : (emps.find((e) => e.id === id)?.name ?? '—')
  return <div className="native-room-canvas" aria-label="3D isometric office; select a worker using their desk or the buttons below" style={{ position: 'relative' }}>
    <OrgPanel nameOf={nameOf} lanes={lanes} crew={crew} />
    {/* `shadows` alone asks for PCFSoftShadowMap, which three has removed: it warned on
        every mount and silently fell back. Name the filter the renderer actually uses. */}
    <Canvas orthographic camera={{ position: [18, 18, 18], near: 0.1, far: 100 }} dpr={1} frameloop={visible ? 'always' : 'never'} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}>
      <Camera width={width} depth={depth} readable={readable} />
      <ChatterClock />
      <DragAwareOrbit target={[0, 0.7, 0]} enableDamping={false}
        minPolarAngle={0.65} maxPolarAngle={1.1} minAzimuthAngle={0.25} maxAzimuthAngle={1.35}
        minZoom={12} maxZoom={160} />
      <color attach="background" args={['#070f1c']} />
      {/* Without a shadow map the light has to do the separating: less flat fill, a stronger key
          from one side, and a dim back light so a far wall is not the same tone as a near one. */}
      <ambientLight intensity={0.95} />
      <directionalLight position={[4, 12, 8]} intensity={2.5} color="#ffe4c2" />
      <directionalLight position={[-7, 5, -6]} intensity={0.5} color="#7fa6d8" />
      {/* No shared floor: every project is its own platform, and the dark between them is the
          point. The terminals get a platform of their own at the back. */}
      <group position={[deck.x, 0, deck.z]}>
        <Block color="#3a3b3d" position={[0, -0.35, 0]} size={[deck.w, 0.7, deck.d]} />
        <Block color="#26272a" position={[0, -0.84, 0]} size={[deck.w - 0.9, 0.28, deck.d - 0.9]} />
        <Block color="#55565a" position={[0, 0.01, 0]} size={[deck.w, 0.06, deck.d]} />
        {[-1, 1].map((side) => <group key={side}>
          <Block color={accent} position={[side * (deck.w / 2 - 0.05), 0.05, 0]} size={[0.1, 0.07, deck.d]} />
          <Block color={accent} position={[0, 0.05, side * (deck.d / 2 - 0.05)]} size={[deck.w, 0.07, 0.1]} />
        </group>)}
        <Plant x={deck.w / 2 - 0.7} z={-deck.d / 2 + 0.7} />
        <Plant x={-deck.w / 2 + 0.7} z={deck.d / 2 - 0.7} />
        <group position={[deck.w / 2 - 0.9, 0, deck.d / 2 - 0.7]}><Person color="#e2a197" host chatterId="host" /></group>
      </group>
      <DragFloor width={width} depth={depth} onTap={onSelect}
        pods={projectPlatforms(floor).map((platform) => ({ id: platform.id, x: platform.x, z: platform.z, w: platform.w, d: platform.d }))} />
      <DragGhost />
      <ProjectOffices floor={floor} accent={accent}
        renderPerson={(member, seat, team) => (
          <group scale={seat.kind === 'lead' ? 0.95 : 0.85}>
            {selected === member.id && <Block color={accent} position={[0, 0.02, 0]} size={[1.1, 0.05, 1.1]} />}
            <Person color={seat.kind === 'lead' ? '#ffcd70' : accent} typing chatterId={member.id}
              onPick={onSelect}
              emp={{ id: member.id, name: member.name, role: member.role, officeId: team.id, reportsTo: member.reportsTo }} />
          </group>
        )} />
      {Array.from({ length: desks.count }, (_, i) => <Desk key={workers[i]?.id ?? `empty_${i}`} worker={workers[i]}
        {...desks.deskAt(i, depth)}
        selected={selected === workers[i]?.id} accent={accent} onSelect={onSelect} emp={emps[i]} />)}
    </Canvas>
  </div>
}
