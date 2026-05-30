import { PageTitle } from "@/components/pageTitle";
import Board from "@/components/board";
import EngineSettingsDialog from "@/sections/engineSettings/engineSettingsDialog";
import {
  boardAtom,
  boardOrientationAtom,
  currentPositionAtom,
  gameAtom,
  gameEvalAtom,
  showBestMoveArrowAtom,
  showPlayerMoveIconAtom,
  engineNameAtom,
  engineDepthAtom,
  engineMultiPvAtom,
  engineWorkersNbAtom,
  evaluationProgressAtom,
  savedEvalsAtom,
} from "@/sections/analysis/states";
import {
  Box,
  IconButton,
  Typography,
  Stack,
  CircularProgress,
  LinearProgress,
} from "@mui/material";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useState, useMemo, useCallback } from "react";
import { Icon } from "@iconify/react";
import { useRouter } from "next/router";
import { usePlayersData } from "@/hooks/usePlayersData";
import { useChessActions } from "@/hooks/useChessActions";
import { useEngine } from "@/hooks/useEngine";
import { getEvaluationBarValue, moveLineUciToSan, getEvaluateGameParams } from "@/lib/chess";
import { Color } from "@/types/enums";
import { useGameDatabase } from "@/hooks/useGameDatabase";
import { useCurrentPosition } from "@/sections/analysis/hooks/useCurrentPosition";
import { CLASSIFICATION_COLORS } from "@/constants";
import LoadGame from "@/sections/analysis/panelHeader/loadGame";
import { logAnalyticsEvent } from "@/lib/firebase";
import { SavedEvals } from "@/types/eval";
import { Haptics } from "@/lib/haptics";

export default function GameAnalysis() {
  const router = useRouter();
  const game = useAtomValue(gameAtom);
  const board = useAtomValue(boardAtom);
  const [gameEval, setEval] = useAtom(gameEvalAtom);
  const [boardOrientation, setBoardOrientation] = useAtom(boardOrientationAtom);
  const showBestMoveArrow = useAtomValue(showBestMoveArrowAtom);


  const engineName = useAtomValue(engineNameAtom);
  const engine = useEngine(engineName);
  
  // Hook for real-time analysis updates
  const position = useCurrentPosition(engine);

  const engineWorkersNb = useAtomValue(engineWorkersNbAtom);
  const [evaluationProgress, setEvaluationProgress] = useAtom(evaluationProgressAtom);
  const engineDepth = useAtomValue(engineDepthAtom);
  const engineMultiPv = useAtomValue(engineMultiPvAtom);
  const { setGameEval, gameFromUrl } = useGameDatabase();
  const setSavedEvals = useSetAtom(savedEvalsAtom);

  const { white, black } = usePlayersData(gameAtom);

  const { goToMove: goToBoardMove, undoMove: undoBoardMove, playMove: playBoardMove } = useChessActions(boardAtom);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardSize, setBoardSize] = useState(360);
  const [evalBar, setEvalBar] = useState({ whiteBarPercentage: 50, label: "0.0" });

  // Responsive board sizing calculation to fit perfectly on any phone screen (100vh / 100dvh)
  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      // Calculate remaining height dynamically. Non-board elements take ~330px
      const calculatedSize = Math.min(width - 16, height - 330);
      setBoardSize(Math.max(calculatedSize, 200));
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Update evaluation bar based on the currently viewed FEN
  useEffect(() => {
    const bestLine = position?.eval?.lines?.[0];
    if (position?.eval && bestLine) {
      setEvalBar(getEvaluationBarValue(position.eval));
    }
  }, [position]);

  // Compute move classification details for the current move being viewed
  const moveClassificationInfo = useMemo(() => {
    const boardHistory = board.history({ verbose: true });
    if (boardHistory.length === 0) return null;

    const lastMove = position.lastMove;
    if (!lastMove) return null;

    const moveIdx = boardHistory.length - 1;
    const moveNum = Math.floor(moveIdx / 2) + 1;
    const playedMoveText = `${moveNum}. ${lastMove.san}`;

    const classification = position.eval?.moveClassification || "";
    let classificationColor = "rgba(255,255,255,0.4)";
    if (classification) {
      classificationColor = CLASSIFICATION_COLORS[classification] || "rgba(255,255,255,0.4)";
    }

    // Best move suggestion
    const bestMove = position.lastEval?.bestMove;
    let bestMoveText = "";
    if (bestMove) {
      try {
        const lastPosition = boardHistory.at(-1)?.before;
        if (lastPosition) {
          const bestMoveSan = moveLineUciToSan(lastPosition)(bestMove);
          if (bestMoveSan !== lastMove.san) {
            bestMoveText = bestMoveSan;
          }
        }
      } catch {
        bestMoveText = bestMove;
      }
    }

    return {
      playedMoveText,
      classification,
      classificationColor,
      bestMoveText,
      isLoading: !position.eval && !board.isCheckmate() && !board.isStalemate(),
    };
  }, [board, position]);

  // Next move button configuration
  const isNextButtonEnabled = useMemo(() => {
    const gameHistory = game.history();
    const boardHistory = board.history();
    return (
      boardHistory.length < gameHistory.length &&
      gameHistory.slice(0, boardHistory.length).join() === boardHistory.join()
    );
  }, [board, game]);

  // Bottom action bar controls
  const handleFlip = () => {
    setBoardOrientation((prev) => !prev);
  };

  const handlePrevMove = () => {
    const boardHistory = board.history();
    if (boardHistory.length === 0) return;
    undoBoardMove();
  };

  const handleNextMove = useCallback(() => {
    if (!isNextButtonEnabled) return;

    const boardHistory = board.history();
    const nextMoveIndex = boardHistory.length;
    const nextMove = game.history({ verbose: true })[nextMoveIndex];
    const comment = game
      .getComments()
      .find((c) => c.fen === nextMove.after)?.comment;

    if (nextMove) {
      playBoardMove({
        from: nextMove.from,
        to: nextMove.to,
        promotion: nextMove.promotion,
        comment,
      });
    }
  }, [isNextButtonEnabled, board, game, playBoardMove]);

  // Jump to specific index in moves history
  const handleJumpToMove = (idx: number) => {
    goToBoardMove(idx, game);
  };

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        handlePrevMove();
      } else if (e.key === "ArrowRight") {
        handleNextMove();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNextMove]);

  // Game analysis engine trigger
  const readyToAnalyse =
    engine?.getIsReady() && game.history().length > 0 && !evaluationProgress;

  const handleAnalyze = useCallback(async () => {
    const params = getEvaluateGameParams(game);
    if (
      !engine?.getIsReady() ||
      params.fens.length === 0 ||
      evaluationProgress
    ) {
      return;
    }

    try {
      const newGameEval = await engine.evaluateGame({
        ...params,
        depth: engineDepth,
        multiPv: engineMultiPv,
        setEvaluationProgress,
        playersRatings: {
          white: white?.rating,
          black: black?.rating,
        },
        workersNb: engineWorkersNb,
      });

      setEval(newGameEval);
      setEvaluationProgress(0);

      if (gameFromUrl) {
        setGameEval(gameFromUrl.id, newGameEval);
      }

      const gameSavedEvals: SavedEvals = params.fens.reduce((acc, fen, idx) => {
        acc[fen] = { ...newGameEval.positions[idx], engine: engineName };
        return acc;
      }, {} as SavedEvals);
      setSavedEvals((prev) => ({
        ...prev,
        ...gameSavedEvals,
      }));

      logAnalyticsEvent("analyze_game", {
        engine: engineName,
        depth: engineDepth,
        multiPv: engineMultiPv,
        nbPositions: params.fens.length,
      });
    } catch (err) {
      console.error("Game analysis error:", err);
    }
  }, [
    engine,
    engineName,
    engineWorkersNb,
    game,
    engineDepth,
    engineMultiPv,
    evaluationProgress,
    setEvaluationProgress,
    setEval,
    gameFromUrl,
    setGameEval,
    setSavedEvals,
    white.rating,
    black.rating,
  ]);

  // Auto-analyze on load
  useEffect(() => {
    if (!gameEval && readyToAnalyse) {
      handleAnalyze();
    }
  }, [gameEval, readyToAnalyse, handleAnalyze]);

  // Render horizontal moves timeline
  const renderMovesList = () => {
    const history = game.history({ verbose: true });
    const boardHistory = board.history();
    if (history.length === 0) {
      return (
        <Typography
          variant="body2"
          color="rgba(255,255,255,0.4)"
          sx={{ fontStyle: "italic", textAlign: "center", width: "100%" }}
        >
          No moves to review
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
          "&::-webkit-scrollbar": { height: 0 },
        }}
      >
        {history.map((move, idx) => {
          const isWhite = idx % 2 === 0;
          const moveNum = Math.floor(idx / 2) + 1;
          const isSelected = boardHistory.length - 1 === idx;

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
                onClick={() => { Haptics.light(); handleJumpToMove(idx); }}
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
        height: "100vh",
        width: "100vw",
        backgroundColor: "#262d31", // Premium dark slate color
        color: "#fff",
        overflow: "hidden",
        fontFamily: "'Inter', 'Roboto', sans-serif",
      }}
    >
      <PageTitle title="Chesskit Game Analysis" />
      <LoadGame />

      {/* 1. TOP HEADER BAR */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          height: 48,
          px: 2,
          backgroundColor: "#21272b",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <IconButton onClick={() => { Haptics.light(); router.push("/"); }} color="inherit" size="small">
          <Icon icon="mdi:chevron-left" width={28} height={28} />
        </IconButton>

        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Icon icon="fa6-solid:magnifying-glass" color="#81b64c" width={20} height={20} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: 0.5 }}>
            Analysis
          </Typography>
        </Stack>

        <IconButton onClick={() => { Haptics.light(); setSettingsOpen(true); }} color="inherit" size="small">
          <Icon icon="mdi:cog" width={22} height={22} />
        </IconButton>
      </Stack>

      {/* 2. HORIZONTAL SLIM EVALUATION PROGRESS BAR */}
      {(game.history().length > 0) && (
        <Box
          sx={{
            height: 14,
            width: "100%",
            backgroundColor: "#312e2b", // Dark side
            position: "relative",
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
            borderBottom: "1px solid rgba(0,0,0,0.3)",
          }}
        >
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

      {/* 3. AUTO ENGINE EVALUATION PROGRESS BANNER */}
      {evaluationProgress > 0 && evaluationProgress < 1 && (
        <Stack sx={{ width: "100%" }} spacing={0.5}>
          <LinearProgress
            variant="determinate"
            value={evaluationProgress * 100}
            sx={{
              height: 4,
              backgroundColor: "rgba(255,255,255,0.06)",
              "& .MuiLinearProgress-bar": { backgroundColor: "#81b64c" }
            }}
          />
          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.5)", textAlign: "center", fontWeight: 700, fontSize: "0.6rem" }}>
            ANALYZING GAME: {Math.round(evaluationProgress * 100)}%
          </Typography>
        </Stack>
      )}

      {/* 4. MOVE CLASSIFICATION SUB-HEADER */}
      {moveClassificationInfo && (
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{
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

          {/* Right: Best Move suggestion */}
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
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          position: "relative",
          px: 1,
        }}
      >
        <Box sx={{ width: boardSize, height: "auto" }}>
          <Board
            id="AnalysisBoard"
            boardSize={boardSize}
            canPlay={true}
            gameAtom={boardAtom}
            whitePlayer={white}
            blackPlayer={black}
            boardOrientation={boardOrientation ? Color.White : Color.Black}
            currentPositionAtom={currentPositionAtom}
            showBestMoveArrow={showBestMoveArrow}
            showPlayerMoveIconAtom={showPlayerMoveIconAtom}
            openingName={position.opening}
          />
        </Box>
      </Box>

      {/* 6. MOVES HISTORY & NAVIGATION CONTROLS */}
      {game.history().length > 0 && (
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            height: 38,
            backgroundColor: "#21272b",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            px: 1.5,
          }}
        >
          {/* Back Move arrow */}
          <IconButton
            size="small"
            onClick={() => { Haptics.light(); handlePrevMove(); }}
            color="inherit"
            disabled={board.history().length === 0}
            sx={{ opacity: board.history().length === 0 ? 0.3 : 0.8 }}
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
            disabled={!isNextButtonEnabled}
            sx={{ opacity: !isNextButtonEnabled ? 0.3 : 0.8 }}
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
          height: 64,
          backgroundColor: "#1c2124",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          pb: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Flip Board option */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); handleFlip(); }}
          sx={{
            cursor: "pointer",
            width: 70,
            opacity: 0.75,
            "&:hover": { opacity: 1 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:swap-vertical" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Flip
          </Typography>
        </Stack>

        {/* Prev Move option */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); handlePrevMove(); }}
          sx={{
            cursor: board.history().length > 0 ? "pointer" : "default",
            width: 70,
            opacity: board.history().length > 0 ? 0.75 : 0.3,
            "&:hover": { opacity: board.history().length > 0 ? 1 : 0.3 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:chevron-left-box-outline" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Prev
          </Typography>
        </Stack>

        {/* Next Move option */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); handleNextMove(); }}
          sx={{
            cursor: isNextButtonEnabled ? "pointer" : "default",
            width: 70,
            opacity: isNextButtonEnabled ? 0.75 : 0.3,
            "&:hover": { opacity: isNextButtonEnabled ? 1 : 0.3 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:chevron-right-box-outline" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Next
          </Typography>
        </Stack>

        {/* Settings option */}
        <Stack
          spacing={0.5}
          alignItems="center"
          onClick={() => { Haptics.light(); setSettingsOpen(true); }}
          sx={{
            cursor: "pointer",
            width: 70,
            opacity: 0.75,
            "&:hover": { opacity: 1 },
            transition: "opacity 0.2s ease",
          }}
        >
          <Icon icon="mdi:cog" width={24} height={24} />
          <Typography variant="caption" sx={{ fontSize: "0.7rem", fontWeight: 600 }}>
            Settings
          </Typography>
        </Stack>
      </Stack>

      {/* ENGINE SETTINGS DIALOG */}
      <EngineSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Box>
  );
}
