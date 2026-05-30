import { PageTitle } from "@/components/pageTitle";
import Board from "@/sections/play/board";
import GameSettingsDialog from "@/sections/play/gameSettings/gameSettingsDialog";
import {
  gameAtom,
  isGameInProgressAtom,
  playerColorAtom,
  enginePlayNameAtom,
  engineEloAtom,
  gameDataAtom,
  hintArrowAtom,
  historyIndexAtom,
  evalsHistoryAtom,
} from "@/sections/play/states";
import {
  Box,
  Button,
  IconButton,
  Typography,
  Stack,
  CircularProgress,
} from "@mui/material";
import { useAtom } from "jotai";
import { useEffect, useState, useMemo } from "react";
import { Icon } from "@iconify/react";
import { useRouter } from "next/router";
import { useChessActions } from "@/hooks/useChessActions";
import { useEngine } from "@/hooks/useEngine";
import { getEvaluationBarValue, setGameHeaders, moveLineUciToSan } from "@/lib/chess";
import { Color, EngineName } from "@/types/enums";
import { useGameDatabase } from "@/hooks/useGameDatabase";
import { openings } from "@/data/openings";
import { getPositionWinPercentage } from "@/lib/engine/helpers/winPercentage";
import { Chess } from "chess.js";
import { Haptics } from "@/lib/haptics";

export default function Play() {
  const router = useRouter();
  const [game, setGame] = useAtom(gameAtom);
  const [isGameInProgress, setIsGameInProgress] = useAtom(isGameInProgressAtom);
  const [playerColor, setPlayerColor] = useAtom(playerColorAtom);
  const [engineElo, setEngineElo] = useAtom(engineEloAtom);
  const [engineName, setEngineName] = useAtom(enginePlayNameAtom);
  const engine = useEngine(engineName);
  
  const [, setGameData] = useAtom(gameDataAtom);
  const [, setHintArrow] = useAtom(hintArrowAtom);
  const [historyIndex, setHistoryIndex] = useAtom(historyIndexAtom);
  const { addGame } = useGameDatabase();

  const { goToMove, undoMove } = useChessActions(gameAtom);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, setIsCalculatingHint] = useState(false);
  const [boardSize, setBoardSize] = useState(360);

  const gameFen = game.fen();

  // Evaluation history and display states
  const [evalsHistory, setEvalsHistory] = useAtom(evalsHistoryAtom);
  const [evalBar, setEvalBar] = useState({ whiteBarPercentage: 50, label: "0.0" });

  const historyIndexValue = useMemo(() => historyIndex, [historyIndex]);

  // Compute active FEN being viewed
  const displayFen = useMemo(() => {
    if (historyIndexValue === -1) return gameFen;
    const history = game.history({ verbose: true });
    if (historyIndexValue >= history.length) return gameFen;

    const tempChess = new Chess();
    for (let i = 0; i <= historyIndexValue; i++) {
      tempChess.move(history[i]);
    }
    return tempChess.fen();
  }, [game, gameFen, historyIndexValue]);

  // Responsive board sizing calculation to fit perfectly on any screen
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isDesktop = width >= 900;
      
      if (isDesktop) {
        // Desktop: Left side has 60% width, board vertically fits within height - 140
        const calculatedSize = Math.min(width * 0.6 - 32, height - 140);
        setBoardSize(Math.max(calculatedSize, 300));
      } else {
        // Mobile: Stacked, board vertically fits within height - 330
        const calculatedSize = Math.min(width - 16, height - 330);
        setBoardSize(Math.max(calculatedSize, 200));
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // active game state persistence: load on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedInProgress = localStorage.getItem("chesskit-game-in-progress");
    const savedPgn = localStorage.getItem("chesskit-active-pgn");
    const savedPlayerColor = localStorage.getItem("chesskit-player-color");
    const savedEngineElo = localStorage.getItem("chesskit-engine-elo");
    const savedEngineName = localStorage.getItem("chesskit-engine-name");
    const savedEvalsHistory = localStorage.getItem("chesskit-evals-history");

    if (savedInProgress === "true" && savedPgn) {
      try {
        const newGame = new Chess();
        newGame.loadPgn(savedPgn);
        setGame(newGame);
        setIsGameInProgress(true);
        if (savedPlayerColor) setPlayerColor(savedPlayerColor as Color);
        if (savedEngineElo) setEngineElo(Number(savedEngineElo));
        if (savedEngineName) setEngineName(savedEngineName as EngineName);
        if (savedEvalsHistory) {
          try {
            setEvalsHistory(JSON.parse(savedEvalsHistory));
          } catch (e) {
            console.error("Failed to parse evaluations history from localStorage:", e);
          }
        }
      } catch (err) {
        console.error("Failed to restore game state from localStorage:", err);
      }
    }
  }, [setGame, setIsGameInProgress, setPlayerColor, setEngineElo, setEngineName, setEvalsHistory]);

  // active game state persistence: save on update
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isGameInProgress) {
      localStorage.setItem("chesskit-game-in-progress", "true");
      localStorage.setItem("chesskit-active-pgn", game.pgn());
      localStorage.setItem("chesskit-player-color", playerColor);
      localStorage.setItem("chesskit-engine-elo", String(engineElo));
      localStorage.setItem("chesskit-engine-name", engineName);
      localStorage.setItem("chesskit-evals-history", JSON.stringify(evalsHistory));
    } else {
      localStorage.setItem("chesskit-game-in-progress", "false");
      localStorage.removeItem("chesskit-active-pgn");
    }
  }, [gameFen, isGameInProgress, playerColor, engineElo, engineName, evalsHistory, game]);

  // Background real-time evaluation loop and queue backfilling
  useEffect(() => {
    if (!engine || !isGameInProgress || game.isGameOver()) return;
    if (game.turn() !== playerColor) return;

    let isCurrent = true;

    const runBgEval = async () => {
      if (!engine.getIsReady()) return;

      const history = game.history({ verbose: true });
      const currentIdx = historyIndexValue === -1 ? history.length - 1 : historyIndexValue;

      // Proactively determine target FEN to evaluate
      let fenToEvaluate = displayFen;
      let targetIsPrevious = false;

      if (evalsHistory[displayFen]) {
        // Active FEN is already evaluated! Proactively backfill previous FEN to compute move classifications
        if (currentIdx >= 0) {
          const prevFen = history[currentIdx].before;
          if (!evalsHistory[prevFen]) {
            fenToEvaluate = prevFen;
            targetIsPrevious = true;
          } else {
            return; // Both current and previous are already evaluated, exit early
          }
        } else {
          return; // At starting position, nothing to do
        }
      }

      try {
        const result = await engine.evaluatePositionWithUpdate({
          fen: fenToEvaluate,
          depth: 12,
          multiPv: 3,
          setPartialEval: (partial) => {
            if (isCurrent && !targetIsPrevious) {
              setGameData((prev) => ({
                ...prev,
                eval: partial,
              }));
            }
          },
        });

        if (isCurrent) {
          setEvalsHistory((prev) => ({
            ...prev,
            [fenToEvaluate]: result,
          }));

          if (!targetIsPrevious) {
            setGameData((prev) => ({
              ...prev,
              eval: result,
            }));
          }
        }
      } catch (err) {
        console.error("Bg eval error:", err);
      }
    };

    runBgEval();

    return () => {
      isCurrent = false;
      engine.stopAllCurrentJobs();
    };
  }, [gameFen, displayFen, engine, isGameInProgress, playerColor, setGameData, evalsHistory, setEvalsHistory, historyIndexValue, game]);

  // Update evaluation bar based on the currently viewed FEN (persists previous values!)
  useEffect(() => {
    const activeEval = evalsHistory[displayFen];
    const bestLine = activeEval?.lines?.[0];
    if (
      activeEval &&
      bestLine &&
      (bestLine.cp !== undefined || bestLine.mate !== undefined)
    ) {
      setEvalBar(getEvaluationBarValue(activeEval));
    }
  }, [displayFen, evalsHistory]);

  // Compute active opening name
  const activeOpeningName = useMemo(() => {
    const currentFenBase = displayFen.split(" ")[0];
    const opening = openings.find((op) => op.fen === currentFenBase);
    return opening ? opening.name : "";
  }, [displayFen]);

  // Compute move classification details for the current move being viewed
  const moveClassificationInfo = useMemo(() => {
    const history = game.history({ verbose: true });
    
    // Find the last move played by the user in the history
    let userMoveIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      const isWhite = i % 2 === 0;
      const moveColor = isWhite ? Color.White : Color.Black;
      if (moveColor === playerColor) {
        userMoveIdx = i;
        break;
      }
    }

    const currentIdx = historyIndexValue === -1 ? userMoveIdx : historyIndexValue;

    if (currentIdx < 0 || history.length === 0) return null;

    // During manual history review, hide if the selected move is not a player move
    if (historyIndexValue !== -1) {
      const isWhite = currentIdx % 2 === 0;
      const moveColor = isWhite ? Color.White : Color.Black;
      if (moveColor !== playerColor) return null;
    }

    const move = history[currentIdx];
    const prevFen = move.before;
    const currentFen = move.after;

    const evalBefore = evalsHistory[prevFen];
    const evalAfter = evalsHistory[currentFen];

    const moveNum = Math.floor(currentIdx / 2) + 1;
    const movePrefix = `${moveNum}.`;
    const playedMoveText = `${movePrefix} ${move.san}`;

    if (!evalBefore || !evalAfter) {
      return {
        playedMoveText,
        classification: "",
        classificationColor: "rgba(255,255,255,0.4)",
        bestMoveText: "",
        bestMoveLabel: "",
        isLoading: true,
      };
    }

    // Evaluations are fully loaded, calculate absolute win chance diffs
    const winBefore = getPositionWinPercentage(evalBefore);
    const winAfter = getPositionWinPercentage(evalAfter);
    const isWhiteMove = currentIdx % 2 === 0;
    const winDiff = (winAfter - winBefore) * (isWhiteMove ? 1 : -1);

    const playedMoveUci = move.from + move.to + (move.promotion || "");
    const bestMoveUci = evalBefore.lines?.[0]?.pv?.[0];

    let classification = "Excellent";
    let classificationColor = "#22ac38"; // Green

    if (winDiff < -20) {
      classification = "Blunder";
      classificationColor = "#df5353"; // Red
    } else if (winDiff < -10) {
      classification = "Mistake";
      classificationColor = "#e69f00"; // Orange
    } else if (winDiff < -5) {
      classification = "Inaccuracy";
      classificationColor = "#f2be1f"; // Yellow
    } else if (winDiff < -2) {
      classification = "Okay";
      classificationColor = "#9e9e9e"; // Muted Gray
    }

    if (playedMoveUci === bestMoveUci) {
      classification = "Best";
      classificationColor = "#22ac38";
    }

    let bestMoveText = "";
    if (bestMoveUci && playedMoveUci !== bestMoveUci) {
      try {
        const bestMoveSan = moveLineUciToSan(prevFen)(bestMoveUci);
        bestMoveText = bestMoveSan;
      } catch {
        bestMoveText = bestMoveUci;
      }
    }

    return {
      playedMoveText,
      classification,
      classificationColor,
      bestMoveText,
      bestMoveLabel: bestMoveText ? "Best" : "",
      isLoading: false,
    };
  }, [game, historyIndexValue, evalsHistory, playerColor]);

  // Hint generation
  const handleHint = async () => {
    if (!engine || !isGameInProgress || game.isGameOver()) return;
    if (game.turn() !== playerColor) return;

    try {
      setIsCalculatingHint(true);
      const bestMove = await engine.getEngineNextMove(gameFen, engineElo, 12);
      if (bestMove) {
        setHintArrow([
          bestMove.slice(0, 2),
          bestMove.slice(2, 4),
          "#81b64c", // Sleek chess.com green!
        ]);
      }
    } catch (err) {
      console.error("Error calculating hint:", err);
    } finally {
      setIsCalculatingHint(false);
    }
  };

  // Undo move logic
  const handleUndo = () => {
    const gameHistory = game.history();
    const turnColor = game.turn();
    setHistoryIndex(-1); // Reset review mode

    if (
      (turnColor === "w" && playerColor === Color.White) ||
      (turnColor === "b" && playerColor === Color.Black)
    ) {
      if (gameHistory.length < 2) return;
      goToMove(gameHistory.length - 2, game);
    } else {
      if (!gameHistory.length) return;
      undoMove();
    }
  };

  // Resign logic
  const handleResign = () => {
    setIsGameInProgress(false);
    setGameHeaders(game, { resigned: playerColor });
  };

  // Open settings
  const handleOptions = () => {
    setSettingsOpen(true);
  };

  // Move history navigation
  const handlePrevMove = () => {
    const history = game.history();
    if (history.length === 0) return;

    let nextIdx = historyIndexValue === -1 ? history.length - 2 : historyIndexValue - 1;
    if (nextIdx < -1) nextIdx = -1; // starting position
    setHistoryIndex(nextIdx);
  };

  const handleNextMove = () => {
    const history = game.history();
    if (history.length === 0 || historyIndexValue === -1) return;

    let nextIdx = historyIndexValue + 1;
    if (nextIdx >= history.length - 1) {
      setHistoryIndex(-1);
    } else {
      setHistoryIndex(nextIdx);
    }
  };

  // Game over check label
  const getResultLabel = () => {
    if (game.isCheckmate()) {
      const winnerColor = game.turn() === "w" ? Color.Black : Color.White;
      const winnerLabel = winnerColor === playerColor ? "You" : "Stockfish";
      return `${winnerLabel} won by checkmate!`;
    }
    if (game.isInsufficientMaterial()) return "Draw by insufficient material";
    if (game.isStalemate()) return "Draw by stalemate";
    if (game.isThreefoldRepetition()) return "Draw by threefold repetition";
    if (game.isDraw()) return "Draw by fifty-move rule";
    return "You resigned";
  };

  // Go to game analysis
  const handleOpenGameAnalysis = async () => {
    const gameToAnalysis = setGameHeaders(game, {
      resigned: !game.isGameOver() ? playerColor : undefined,
    });
    const gameId = await addGame(gameToAnalysis);
    router.push({ pathname: "/analysis", query: { gameId } });
  };

  // Move history elements
  const renderMovesList = () => {
    const history = game.history({ verbose: true });
    if (history.length === 0) {
      return (
        <Typography
          variant="body2"
          color="rgba(255,255,255,0.4)"
          sx={{ fontStyle: "italic", textAlign: "center", width: "100%" }}
        >
          No moves played yet
        </Typography>
      );
    }

    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          overflowX: "auto",
          width: "100%",
          px: 1,
          "&::-webkit-scrollbar": { height: 0 }, // Hide scrollbar for a touch-app feel
        }}
      >
        {history.map((move, idx) => {
          const isWhite = idx % 2 === 0;
          const moveNum = Math.floor(idx / 2) + 1;
          const isSelected = historyIndexValue === -1 ? idx === history.length - 1 : historyIndexValue === idx;

          return (
            <Stack key={idx} direction="row" alignItems="center" spacing={0.5} sx={{ flexShrink: 0 }}>
              {isWhite && (
                <Typography
                  variant="body2"
                  color="rgba(255,255,255,0.35)"
                  sx={{ fontWeight: 600 }}
                >
                  {moveNum}.
                </Typography>
              )}
              <Box
                onClick={() => { Haptics.light(); setHistoryIndex(idx); }}
                sx={{
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  cursor: "pointer",
                  backgroundColor: isSelected ? "rgba(255, 255, 255, 0.15)" : "transparent",
                  border: isSelected ? "1px solid rgba(255, 255, 255, 0.3)" : "1px solid transparent",
                  transition: "all 0.15s ease",
                  "&:hover": {
                    backgroundColor: "rgba(255, 255, 255, 0.08)",
                  },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: isSelected ? "#fff" : "rgba(255,255,255,0.75)",
                    fontWeight: isSelected ? 700 : 500,
                  }}
                >
                  {move.san}
                </Typography>
              </Box>
            </Stack>
          );
        })}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        width: "100vw",
        backgroundColor: "#262d31", // Premium dark slate color matching Chess.com app
        color: "#fff",
        overflow: "hidden",
        fontFamily: "'Inter', 'Roboto', sans-serif",
      }}
    >
      <PageTitle title="Chessmate" />

      {/* 1. TOP HEADER BAR */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          height: "calc(48px + env(safe-area-inset-top, 0px))",
          pt: "env(safe-area-inset-top, 0px)",
          px: 2,
          backgroundColor: "#21272b",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <IconButton onClick={() => { Haptics.light(); router.push("/database"); }} color="inherit" size="small">
          <Icon icon="mdi:database" width={24} height={24} />
        </IconButton>

        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Icon icon="fa6-solid:chess-pawn" color="#81b64c" width={22} height={22} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: 0.5 }}>
            Chessmate
          </Typography>
        </Stack>

        <IconButton onClick={() => { Haptics.light(); handleOptions(); }} color="inherit" size="small">
          <Icon icon="mdi:cog" width={22} height={22} />
        </IconButton>
      </Stack>

      {/* MAIN CONTAINER: RESPONSIVE SPLIT GRID LAYOUT */}
      <Box
        sx={{
          flex: 1,
          display: "grid",
          width: "100%",
          height: "100%",
          overflow: "hidden",
          gridTemplateColumns: { xs: "1fr", md: "6fr 4fr" },
          gridTemplateRows: {
            xs: "auto auto 1fr auto calc(64px + env(safe-area-inset-bottom, 0px))",
            md: "auto auto 1fr auto calc(64px + env(safe-area-inset-bottom, 0px))",
          },
          gridTemplateAreas: {
            xs: `
              "eval"
              "classify"
              "board"
              "moves"
              "buttons"
            `,
            md: `
              "board eval"
              "board classify"
              "board spacer"
              "board moves"
              "board buttons"
            `,
          },
          backgroundColor: "#262d31",
        }}
      >

      {/* 2. HORIZONTAL EVALUATION PROGRESS BAR */}
      {(isGameInProgress || game.history().length > 0) && (
        <Box
          sx={{
            gridArea: "eval",
            height: 14,
            width: "100%",
            backgroundColor: "#312e2b", // Dark side (Black advantage)
            position: "relative",
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
            borderBottom: "1px solid rgba(0,0,0,0.3)",
          }}
        >
          {/* White Advantage portion */}
          <Box
            sx={{
              height: "100%",
              width: `${evalBar.whiteBarPercentage}%`,
              backgroundColor: "#fff",
              transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
              position: "absolute",
              left: 0,
              top: 0,
              zIndex: 1,
            }}
          />

          {/* Overlaid value scores */}
          {evalBar.whiteBarPercentage >= 50 ? (
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                left: 8,
                zIndex: 2,
                fontWeight: 800,
                fontSize: "0.65rem",
                color: "#000",
                lineHeight: 1,
              }}
            >
              +{evalBar.label}
            </Typography>
          ) : (
            <Typography
              variant="caption"
              sx={{
                position: "absolute",
                right: 8,
                zIndex: 2,
                fontWeight: 800,
                fontSize: "0.65rem",
                color: "#fff",
                lineHeight: 1,
              }}
            >
              -{evalBar.label}
            </Typography>
          )}
        </Box>
      )}

      {/* 4. MOVE CLASSIFICATION SUB-HEADER (Mistake, Blunder, Best, Excellent) */}
      {moveClassificationInfo && (
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
            gridArea: "classify",
            height: 28,
            backgroundColor: "#1c2124",
            px: 2,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          {/* Left: Played move + classification */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.8)", fontWeight: 600, fontSize: "0.8rem" }}>
              {moveClassificationInfo.playedMoveText}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: moveClassificationInfo.classificationColor,
                fontWeight: 800,
                fontSize: "0.8rem",
                textTransform: "capitalize",
              }}
            >
              {moveClassificationInfo.classification}
            </Typography>
            {moveClassificationInfo.isLoading && (
              <CircularProgress size={10} color="inherit" sx={{ opacity: 0.5 }} />
            )}
          </Stack>

          {/* Right: Best Move suggest */}
          {moveClassificationInfo.bestMoveText && (
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.45)", fontWeight: 500, fontSize: "0.8rem" }}>
                {moveClassificationInfo.bestMoveText}
              </Typography>
              <Typography variant="body2" sx={{ color: "#22ac38", fontWeight: 800, fontSize: "0.8rem" }}>
                Best
              </Typography>
            </Stack>
          )}
        </Stack>
      )}

      {/* 5. CHESSBOARD AND OVERLAYS WRAPPER */}
      <Box
        sx={{
          gridArea: "board",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
          px: 1,
          py: { xs: 0, md: 2 },
          height: "100%",
          overflow: "hidden",
          borderRight: { xs: "none", md: "1px solid rgba(255,255,255,0.06)" },
        }}
      >
        {/* Play board container sized exactly */}
        <Box sx={{ width: boardSize, height: "auto" }}>
          <Board boardSize={boardSize} openingName={activeOpeningName} />
        </Box>

        {/* START GAME / NEW GAME INTERACTION OVERLAY CARDS */}
        {!isGameInProgress && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(38, 45, 49, 0.9)",
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              px: 3,
            }}
          >
            {game.history().length === 0 ? (
              // NEW GAME START
              <Stack
                spacing={3}
                alignItems="center"
                sx={{
                  backgroundColor: "#2c353a",
                  p: 4,
                  borderRadius: 3,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                  maxWidth: 320,
                  textAlign: "center",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Icon icon="fa6-solid:chess-pawn" color="#81b64c" width={48} height={48} />
                <Stack spacing={1}>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    Play vs Stockfish
                  </Typography>
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.6)" }}>
                    Play chess locally against Stockfish directly in your browser. Choose your difficulty and color.
                  </Typography>
                </Stack>
                <Button
                  variant="contained"
                  onClick={() => { Haptics.light(); handleOptions(); }}
                  sx={{
                    backgroundColor: "#81b64c",
                    color: "#fff",
                    fontWeight: 700,
                    textTransform: "none",
                    px: 4,
                    py: 1.25,
                    fontSize: "1rem",
                    borderRadius: 2,
                    boxShadow: "0 4px 12px rgba(129, 182, 76, 0.4)",
                    "&:hover": {
                      backgroundColor: "#73a543",
                    },
                  }}
                >
                  New Game
                </Button>
              </Stack>
            ) : (
              // GAME OVER RECAP
              <Stack
                spacing={3}
                alignItems="center"
                sx={{
                  backgroundColor: "#2c353a",
                  p: 4,
                  borderRadius: 3,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                  maxWidth: 320,
                  textAlign: "center",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <Icon icon="mdi:trophy" color="#ffd700" width={48} height={48} />
                <Stack spacing={1}>
                  <Typography variant="h5" sx={{ fontWeight: 800 }}>
                    Game Finished
                  </Typography>
                  <Typography variant="body1" sx={{ color: "#dbac86", fontWeight: 700 }}>
                    {getResultLabel()}
                  </Typography>
                </Stack>
                <Stack spacing={1.5} width="100%">
                  <Button
                    variant="contained"
                    onClick={() => { Haptics.light(); handleOpenGameAnalysis(); }}
                    sx={{
                      backgroundColor: "#81b64c",
                      color: "#fff",
                      fontWeight: 700,
                      textTransform: "none",
                      py: 1.25,
                      borderRadius: 2,
                      boxShadow: "0 4px 12px rgba(129, 182, 76, 0.4)",
                      "&:hover": {
                        backgroundColor: "#73a543",
                      },
                    }}
                  >
                    Open Analysis
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={() => { Haptics.light(); handleOptions(); }}
                    sx={{
                      borderColor: "rgba(255,255,255,0.2)",
                      color: "#fff",
                      fontWeight: 700,
                      textTransform: "none",
                      py: 1.25,
                      borderRadius: 2,
                      "&:hover": {
                        borderColor: "rgba(255,255,255,0.4)",
                        backgroundColor: "rgba(255,255,255,0.04)",
                      },
                    }}
                  >
                    Play Again
                  </Button>
                </Stack>
              </Stack>
            )}
          </Box>
        )}
      </Box>

      {/* DESKTOP SIDEBAR SPACER */}
      <Box
        sx={{
          gridArea: "spacer",
          display: { xs: "none", md: "block" },
          backgroundColor: "#1c2124",
        }}
      />

      {/* 6. MOVES HISTORY & NAVIGATION CONTROLS */}
      {game.history().length > 0 && (
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            gridArea: "moves",
            height: 38,
            backgroundColor: "#1c2124", // matches control panel background on desktop
            borderTop: "1px solid rgba(255,255,255,0.06)",
            px: 1.5,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Back Move arrow */}
          <IconButton
            size="small"
            onClick={() => { Haptics.light(); handlePrevMove(); }}
            color="inherit"
            disabled={historyIndexValue === 0}
            sx={{ opacity: historyIndexValue === 0 ? 0.3 : 0.8 }}
          >
            <Icon icon="mdi:chevron-left" width={24} height={24} />
          </IconButton>

          {/* Horizontally scrollable moves list */}
          <Box sx={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center" }}>
            {renderMovesList()}
          </Box>

          {/* Next Move arrow */}
          <IconButton
            size="small"
            onClick={() => { Haptics.light(); handleNextMove(); }}
            color="inherit"
            disabled={historyIndexValue === -1}
            sx={{ opacity: historyIndexValue === -1 ? 0.3 : 0.8 }}
          >
            <Icon icon="mdi:chevron-right" width={24} height={24} />
          </IconButton>
        </Stack>
      )}

      {/* 7. BOTTOM ACTION BUTTON BAR */}
      <Stack
        direction="row"
        justifyContent="space-around"
        alignItems="center"
        sx={{
          gridArea: "buttons",
          height: "calc(64px + env(safe-area-inset-bottom, 0px))",
          pt: 1,
          pb: "env(safe-area-inset-bottom, 0px)",
          backgroundColor: "#1c2124",
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Button Options */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); handleOptions(); }}
          sx={{
            cursor: "pointer",
            width: 70,
            opacity: 0.75,
            "&:hover": { opacity: 1 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:menu" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Options
          </Typography>
        </Stack>

        {/* Button Resign */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); handleResign(); }}
          sx={{
            cursor: isGameInProgress ? "pointer" : "default",
            width: 70,
            opacity: isGameInProgress ? 0.75 : 0.3,
            "&:hover": { opacity: isGameInProgress ? 1 : 0.3 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:flag" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Resign
          </Typography>
        </Stack>

        {/* Button Hint */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); handleHint(); }}
          sx={{
            cursor: isGameInProgress && game.turn() === playerColor ? "pointer" : "default",
            width: 70,
            opacity: isGameInProgress && game.turn() === playerColor ? 0.75 : 0.3,
            "&:hover": { opacity: isGameInProgress && game.turn() === playerColor ? 1 : 0.3 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:lightbulb" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Hint
          </Typography>
        </Stack>

        {/* Button Undo */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); handleUndo(); }}
          sx={{
            cursor: game.history().length > 0 ? "pointer" : "default",
            width: 70,
            opacity: game.history().length > 0 ? 0.75 : 0.3,
            "&:hover": { opacity: game.history().length > 0 ? 1 : 0.3 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:undo" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Undo
          </Typography>
        </Stack>
      </Stack>

      </Box> {/* END MAIN RESPONSIVE GRID CONTAINER */}

      {/* SETTINGS PARAMETERS DIALOG */}
      <GameSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Box>
  );
}
