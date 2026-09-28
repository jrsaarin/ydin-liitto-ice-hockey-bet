// Everything that defines one season of the bet lives here.
export const CONFIG = {
  season: 20262027,
  // First and last day of the regular season. Playoffs are not part of the bet.
  seasonStart: "2026-09-29",
  seasonEnd: "2027-04-10",
  // NHL game type 2 is the regular season.
  gameTypes: [2],
  // Team that holds the cup before the first game.
  startingHolder: "CAR",
  // Prefilled in the setup form. The draft order is shuffled on the server.
  players: ["Paltsi", "Herra Tossavainen", "Läpä", "R", "Taikuri", "Stidi", "AV"],
  // The player who runs the league. Logging in with the commissioner password
  // plays as this name, and nobody else can choose it.
  commissioner: "R",
  playerCount: 7,
  teamsPerPlayer: 4,
};
