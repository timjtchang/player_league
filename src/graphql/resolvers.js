const { GraphQLError } = require("graphql");
const ps = require("../services/PlayerService");
const ms = require("../services/MatchService");

function queryHelper(query) {
  let err_msg = "invalid fields: ";

  if (
    !query.fname ||
    query.fname.length === 0 ||
    !/^[a-zA-Z]+$/.test(query.fname)
  ) {
    err_msg += "fname, ";
  }

  if (query.lname && !/^[a-zA-Z]+$/.test(query.lname)) {
    err_msg += "lname, ";
  }

  if (query.initial_balance_usd_cents === undefined) {
    err_msg += "balance_usd_cents, ";
  } else {
    let usd = parseFloat(query.initial_balance_usd_cents);
    if (usd < 0 || usd !== parseInt(usd)) err_msg += "balance_usd_cents, ";
  }

  if (query.handed === undefined) {
    err_msg += "handed, ";
  } else {
    let handed = query.handed.toLowerCase();
    if (handed !== "left" && handed !== "right" && handed !== "ambi")
      err_msg += "handed, ";
  }

  if (err_msg !== "invalid fields: ")
    return err_msg.substring(0, err_msg.length - 2);
  return ""; // Return empty string if valid
}

async function decorate_match_graphQL(match) {
  const p1 = await ps.getPlayer(match.p1_id);
  const p2 = await ps.getPlayer(match.p2_id);
  const active = ms.IsMatchActive(match._id);

  let winner = null;

  if (match.winner_pid && match.winner_pid == p1._id) winner = p1;
  else if (match.winner_pid && match.winner_pid == p2._id) winner = p2;

  return {
    mid: match._id.toString(),
    is_active: active,
    age: Math.round(
      (new Date().getTime() - new Date(match.created_at).getTime()) / 1000
    ),
    ended_at: match.ended_at,
    entry_fee_usd_cents: match.entry_fee_usd_cents,
    p1_id: match.p1_id,
    p1_name: p1 ? `${p1.fname} ${p1.lname}` : "Unknown",
    p1: await decorate_player_graphQL(p1),
    p1_points: match.p1_points,
    p2_id: match.p2_id,
    p2: await decorate_player_graphQL(p2),
    p2_name: p2 ? `${p2.fname} ${p2.lname}` : "Unknown",
    p2_points: match.p2_points,
    prize_usd_cents: match.prize_usd_cents,
    winner_pid: winner ? winner._id : null,
    winner: winner ? await decorate_player_graphQL(winner) : null,
  };
}

async function decorate_player_graphQL(player) {
  if (player === null) {
    return {};
  }
  let efficiency = player.num_join > 0 ? player.num_won / player.num_join : 0;

  const handMap = { L: "left", R: "right", A: "ambi" };

  const mid = ps.getInActiveMatchByPlayer(player._id.toString());

  return {
    pid: player._id.toString(),
    name: player.lname ? `${player.fname} ${player.lname}` : player.fname,
    handed: handMap[player.handed] || "undefined",
    is_active: player.is_active,
    in_active_match: mid,
    balance_usd_cents: player.balance_usd_cents,
    num_join: player.num_join,
    num_won: player.num_won,
    efficiency: efficiency,
    total_prize_usd_cents: player.total_prize_usd_cents,
  };
}

/**
 * RESOLVERS
 */
const resolvers = {
  Query: {
    player: async (_, { pid }) => {
      let player = await ps.getPlayer(pid);
      if (!player) return null;
      return await decorate_player_graphQL(player);
    },

    players: async (_, { is_active, q }) => {
      const activeStr = is_active !== undefined ? String(is_active) : "*";
      const players = await ps.getPlayers(activeStr);

      const allPlayers = await Promise.all(
        players.map(async (p) => await decorate_player_graphQL(p))
      );

      if (!q) return allPlayers;

      const keyword = q.toLowerCase();
      return allPlayers.filter((p) => p.name.toLowerCase().includes(keyword));
    },

    match: async (_, { mid }) => {
      let match = await ms.getMatchById(mid);
      if (!match) return null;
      return await decorate_match_graphQL(match);
    },

    matches: async (_, { is_active }) => {
      if (is_active) {
        const matches = await ms.getActiveMatchArray();
        return await Promise.all(matches.map((m) => decorate_match_graphQL(m)));
      } else {
        const matches = await ms.getAllMatches();
        return await Promise.all(matches.map((m) => decorate_match_graphQL(m)));
      }
    },

    dashboard: async () => {
      const allPlayers = await ps.getPlayers("*");
      const numTotal = allPlayers.length;
      const numActive = allPlayers.filter((p) => p.is_active).length;
      const numInactive = numTotal - numActive;
      const avgBalance =
        numTotal > 0
          ? Math.floor(
              allPlayers.reduce((sum, p) => sum + p.balance_usd_cents, 0) /
                numTotal
            )
          : 0;

      return {
        player: {
          avg_balance_usd_cents: avgBalance,
          num_total: numTotal,
          num_active: numActive,
          num_inactive: numInactive,
        },
      };
    },
  },

  Mutation: {
    /**
     * POST POINTS
     */
    // matchAward: async (obj, input) => {
    //   let { mid, pid, points } = input;

    //   if (!points || points <= 0 || isNaN(Number(points)))
    //     throw new GraphQLError("Invalid points value");

    //   points = Number(points);
    //   let status = await ms.postPoints(mid, pid, points);

    //   if (status === "notactive") throw new GraphQLError("Match not active");
    //   else if (status === "notexist")
    //     throw new GraphQLError("Match does not exist");
    //   else if (status === "success") {
    //     let match = await ms.getMatchById(mid);
    //     return await decorate_match_graphQL(match);
    //   } else throw new GraphQLError("Unknown error");
    // },

    /**
     * CREATE MATCH (Orchestrator)
     */
    matchCreate: async (obj, input) => {
      if (!input) throw new Error("Body is empty");

      const p1_busy = ps.getInActiveMatchByPlayer(input.p1_id);
      const p2_busy = ps.getInActiveMatchByPlayer(input.p2_id);
      if (p1_busy || p2_busy) throw new Error("inmatch");

      const p1 = await ps.getPlayer(input.p1_id);
      const p2 = await ps.getPlayer(input.p2_id);
      if (!p1 || !p2) throw new Error("not exist");
      if (
        p1.balance_usd_cents < input.entry_fee_usd_cents ||
        p2.balance_usd_cents < input.entry_fee_usd_cents
      )
        throw new Error("insufficient");

      let match = await ms.createMatch(input);

      if (typeof match === "string") {
        if (match === "unexist") throw new Error("not exist");
        if (match === "unactive") throw new Error("not active");
        throw new Error("err");
      }

      await ps.updatePlayer(input.p1_id, {
        balance_usd_cents: p1.balance_usd_cents - input.entry_fee_usd_cents,
        num_join: p1.num_join + 1,
      });
      await ps.updatePlayer(input.p2_id, {
        balance_usd_cents: p2.balance_usd_cents - input.entry_fee_usd_cents,
        num_join: p2.num_join + 1,
      });

      await ps.setPlayerInActiveMatch(input.p1_id, match._id.toString());
      await ps.setPlayerInActiveMatch(input.p2_id, match._id.toString());

      return await decorate_match_graphQL(match);
    },

    /**
     * END MATCH (Orchestrator)
     */
    matchEnd: async (obj, input) => {
      let mid = input.mid;

      let result = await ms.endMatch(mid);

      if (result.status === "notexist" || result.status === "notactive")
        throw new GraphQLError(result.status);
      else if (result.status === "tied") {
        ps.clearPlayerFromMatch(result.p1_id);
        ps.clearPlayerFromMatch(result.p2_id);
        return await decorate_match_graphQL(result.match);
      }

      if (result.status === "success") {
        await ps.payWinner(result.winner_pid, result.prize_usd_cents);

        let winner = await ps.getPlayer(result.winner_pid);
        await ps.updatePlayer(result.winner_pid, {
          num_won: (winner.num_won || 0) + 1,
        });

        let p1 = await ps.getPlayer(result.p1_id);
        let p2 = await ps.getPlayer(result.p2_id);

        ps.clearPlayerFromMatch(result.p1_id);
        ps.clearPlayerFromMatch(result.p2_id);

        const match = await ms.getMatchById(mid);

        return await decorate_match_graphQL(match);
      }
      return null;
    },

    /**
     * PLAYER CRUD
     */
    playerCreate: async (obj, { playerInput }) => {
      let err_msg = queryHelper(playerInput);
      console.log(err_msg);

      if (err_msg !== "") return null;

      let id = await ps.createPlayer(playerInput);
      let player = await ps.getPlayer(id);
      return await decorate_player_graphQL(player);
    },

    playerDelete: async (obj, input) => {
      let status = await ps.deletePlayer(input.pid);
      if (!status) throw new GraphQLError("err");
      return true;
    },

    playerDeposit: async (obj, input) => {
      let { pid, amount_usd_cents } = input;
      if (!amount_usd_cents || amount_usd_cents <= 0)
        throw new GraphQLError("cents err");

      let old_bal = await ps.getBalance(pid);
      if (old_bal === undefined) throw new GraphQLError("old cents err");

      await ps.updatePlayer(pid, {
        balance_usd_cents: old_bal + amount_usd_cents,
      });

      let player = await ps.getPlayer(pid);
      return await decorate_player_graphQL(player);
    },

    playerUpdate: async (obj, req) => {
      let { pid, playerInput } = req;
      let status = await ps.updatePlayer(pid, playerInput);
      if (!status) return null;

      return await decorate_player_graphQL(status);
    },

    postPoints: async (obj, input) => {
      let { mid, pid, amount } = input;
      let res = await ms.postPoints(mid, pid, amount);

      if (res === "success") {
        const match = await ms.getMatchById(mid);
        return decorate_match_graphQL(match);
      } else return {};
    },
  },
};

module.exports = resolvers;
