// Port of the kit's example bot, for calibrating the local sim against the published baseline (1.15).
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
export class Starter {
  constructor(hello) { this.reach = hello.config.loot.pickup_radius }
  act(obs) {
    const me = obs.self
    const [x, y, z] = me.pos
    const goal = obs.zone.next_center
    const yaw = Math.atan2(goal[1] - y, goal[0] - x)
    const act = { move: [Math.cos(yaw), Math.sin(yaw)], aim: [yaw, 0], boost: !me.in_zone, jump: obs.tick % 40 === 0, fire: [false, false] }
    if (obs.offer) act.pick = 0
    const near = obs.pickups.find((p) => dist(p.pos, me.pos) < this.reach && p.kind !== "gun")
    if (!me.weapons[1] && near) act.take = near.id
    const enemy = obs.mechs.filter((m) => m.kind === "mech").sort((a, b) => dist(a.pos, me.pos) - dist(b.pos, me.pos))[0]
    if (enemy) {
      const t = enemy.pos
      act.aim = [Math.atan2(t[1] - y, t[0] - x), Math.atan2(t[2] - z - 2.5, dist(t, me.pos))]
      act.fire = [true, true]
    }
    return act
  }
}
