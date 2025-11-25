const MongoWrapper = require("../db/MongoWrapper");

class PlayerService {
  constructor() {
    this._mgdb = new MongoWrapper();
    this.activePlayerMap = new Map();
  }

  /**
   * INITIALIZATION
   */
  async init() {
    console.log("Initializing Active Match Cache...");
    const activeMatches = await this._mgdb._collectionMatch
      .find({ ended_at: null })
      .toArray();

    for (const match of activeMatches) {
      const mid = match._id.toString();
      this.activePlayerMap.set(String(match.p1_id), mid);
      this.activePlayerMap.set(String(match.p2_id), mid);
    }
    console.log(
      `Cache Loaded. ${this.activePlayerMap.size} players currently busy.`
    );
  }

  /**
   * PLAYER CRUD
   */
  async createPlayer(data) {
    let player = {};

    player.created_at = new Date();
    player.fname = data.fname || "";
    player.lname = data.lname || "";
    player.is_active = data.is_active == null ? true : data.is_active;

    if (data.handed) {
      const h = data.handed.toLowerCase();
      player.handed =
        h === "left" ? "L" : h === "right" ? "R" : h === "ambi" ? "A" : "err";
    }

    if (data.initial_balance_usd_cents != undefined) {
      player.balance_usd_cents = parseInt(data.initial_balance_usd_cents);
    } else {
      player.balance_usd_cents = 0;
    }

    player.num_won = 0;
    player.num_join = 0;
    player.total_prize_usd_cents = 0;

    const pid = await this._mgdb.createPlayer(player);
    return pid;
  }

  async getPlayer(pid) {
    const player = await this._mgdb.getPlayer(pid);

    if (!player || player.length === 0) return null;

    return Array.isArray(player) ? player[0] : player;
  }

  async getPlayers(active = "*") {
    const is_active = active === "*" ? undefined : active === "true";
    const players = await this._mgdb.getAllPlayers(is_active);

    return players.sort((a, b) => a.fname.localeCompare(b.fname));
  }

  async updatePlayer(pid, data) {
    let player = await this.getPlayer(pid);
    if (!player) return null;

    let updateData = {};
    if (data.is_active !== undefined) updateData.is_active = data.is_active;
    if (data.lname !== undefined) updateData.lname = data.lname;

    if (data.balance_usd_cents !== undefined) {
      updateData.balance_usd_cents = data.balance_usd_cents;
    }

    if (data.num_won !== undefined) updateData.num_won = data.num_won;
    if (data.num_join !== undefined) updateData.num_join = data.num_join;
    if (data.total_prize_usd_cents !== undefined)
      updateData.total_prize_usd_cents = data.total_prize_usd_cents;

    await this._mgdb.updatePlayer(pid, { ...player, ...updateData });

    return await this.getPlayer(pid);
  }

  async deletePlayer(pid) {
    const res = await this._mgdb.deletePlayer(pid);
    return res.deletedCount > 0;
  }

  async getBalance(pid) {
    const player = await this.getPlayer(pid);
    return player ? player.balance_usd_cents : undefined;
  }

  /**
   * HELPERS & STATE MANAGEMENT
   */

  async payWinner(pid, amount) {
    let player = await this.getPlayer(pid);

    if (!player) return "not exist";

    const newBalance = (player.balance_usd_cents || 0) + amount;

    await this.updatePlayer(pid, {
      balance_usd_cents: newBalance,
    });

    return "success";
  }

  getInActiveMatchByPlayer(pid) {
    return this.activePlayerMap.get(String(pid)) || null;
  }

  async setPlayerInActiveMatch(pid, mid) {
    const p = await this.getPlayer(pid);
    if (!p) return "player not exist";

    if (this.activePlayerMap.get(String(pid))) {
      return "player is in active match";
    }

    this.activePlayerMap.set(String(pid), String(mid));
    return true;
  }

  clearPlayerFromMatch(pid) {
    this.activePlayerMap.delete(String(pid));
  }

  /**
   * DECORATORS
   */

  returnName(fname, lname = "") {
    return lname ? `${fname} ${lname}` : fname;
  }

  returnHanded(handed) {
    const map = { R: "right", L: "left", A: "ambi" };
    return map[handed] || "undefined";
  }
}

module.exports = new PlayerService();
