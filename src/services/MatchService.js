const MongoWrapper = require("../db/MongoWrapper");
const { ObjectId } = require("mongodb");

class MatchService {
  constructor() {
    this._mgdb = new MongoWrapper();
    this.activeMatchIDs = new Set();
  }

  async init() {
    console.log("Initializing Active Match Set...");

    const matches = await this._mgdb._collectionMatch
      .find({ ended_at: null })
      .project({ _id: 1 })
      .toArray();

    for (const m of matches) {
      this.activeMatchIDs.add(m._id.toString());
    }
    console.log(
      `Match Service Ready. ${this.activeMatchIDs.size} active matches.`
    );
  }

  /**
   * MATCH CREATION
   */
  async createMatch(data) {
    if (data.entry_fee_usd_cents < 0 || data.prize_usd_cents < 0) return "err";

    const p1 = await this._mgdb.getPlayer(data.p1_id);
    const p2 = await this._mgdb.getPlayer(data.p2_id);

    if (!p1 || !p2) return "unexist";

    let match = {
      ...data,
      p1_name: `${p1.fname} ${p1.lname}`,
      p2_name: `${p2.fname} ${p2.lname}`,
      created_at: new Date(),
      ended_at: null,
      p1_points: 0,
      p2_points: 0,
      is_active: true,
    };

    const mid = await this._mgdb.createMatch(match);
    match._id = mid;

    this.activeMatchIDs.add(mid.toString());

    return match;
  }

  /**
   * READ OPERATIONS
   */
  async getMatchById(mid) {
    const matchArr = await this._mgdb.getMatch(mid);
    if (!matchArr || matchArr.length === 0) return null;
    return matchArr[0];
  }

  async getActiveMatchArray() {
    if (this.activeMatchIDs.size === 0) return [];

    const ids = Array.from(this.activeMatchIDs).map((id) => new ObjectId(id));

    const activeMatches = await this._mgdb._collectionMatch
      .find({ _id: { $in: ids } })
      .toArray();

    // Sort by prize
    activeMatches.sort((a, b) => b.prize_usd_cents - a.prize_usd_cents);

    return activeMatches;
  }

  /**
   * GAMEPLAY OPERATIONS
   */
  async postPoints(mid, pid, points) {
    if (!this.IsMatchActive(mid)) return "notactive";

    const match = await this.getMatchById(mid);
    if (!match) return "notexist";

    let update = {};
    if (String(pid) === String(match.p1_id)) {
      update.p1_points = (match.p1_points || 0) + points;
    } else if (String(pid) === String(match.p2_id)) {
      update.p2_points = (match.p2_points || 0) + points;
    } else {
      return "notinmatch";
    }

    await this._mgdb.updateMatch(mid, update);
    return "success";
  }

  async endMatch(mid) {
    if (!this.IsMatchActive(mid)) return { status: "notactive" };

    const match = await this.getMatchById(mid);
    if (!match) return { status: "notexist" };

    if (match.p1_points === match.p2_points) return { status: "tied" };

    const winner_pid =
      match.p1_points > match.p2_points ? match.p1_id : match.p2_id;

    await this._mgdb.updateMatch(mid, { ended_at: new Date() });

    this.deleteActiveMatch(mid);

    return {
      status: "success",
      match: match,
      winner_pid: winner_pid,
      prize_usd_cents: match.prize_usd_cents,
      p1_id: match.p1_id,
      p2_id: match.p2_id,
    };
  }

  /**
   * HELPERS
   */

  deleteActiveMatch(mid) {
    this.activeMatchIDs.delete(String(mid));
  }

  IsMatchActive(mid) {
    return this.activeMatchIDs.has(String(mid));
  }
}

module.exports = new MatchService();
