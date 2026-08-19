// Worm entity. Position is the centre of a WORM_RADIUS circle; feet at y+5.

export class Worm {
  constructor({ id, teamIndex, name, x, y, hp }) {
    this.id = id;
    this.teamIndex = teamIndex;
    this.name = name;
    this.hp = hp;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.facing = 1; // 1 right, -1 left
    this.aimAngle = 0; // radians of elevation; + is up, range [-pi/2, pi/2]
    this.alive = true;
    this.airborne = false;
    this.walkAccum = 0; // sub-pixel walk remainder
  }

  serialize() {
    return [
      this.id, this.teamIndex, this.name, this.hp,
      this.x, this.y, this.vx, this.vy,
      this.facing, this.aimAngle,
      this.alive ? 1 : 0, this.airborne ? 1 : 0,
      this.walkAccum,
    ];
  }

  static deserialize(a) {
    const w = new Worm({ id: a[0], teamIndex: a[1], name: a[2], x: a[4], y: a[5], hp: a[3] });
    w.vx = a[6];
    w.vy = a[7];
    w.facing = a[8];
    w.aimAngle = a[9];
    w.alive = a[10] === 1;
    w.airborne = a[11] === 1;
    w.walkAccum = a[12];
    return w;
  }
}
