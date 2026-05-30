import { useAtom, useAtomValue } from "jotai";
import {
  engineEloAtom,
  gameAtom,
  playerColorAtom,
  isGameInProgressAtom,
  gameDataAtom,
  enginePlayNameAtom,
  hintArrowAtom,
  historyIndexAtom,
} from "./states";
import { useChessActions } from "@/hooks/useChessActions";
import { useEffect, useMemo } from "react";
import { useScreenSize } from "@/hooks/useScreenSize";
import { useEngine } from "@/hooks/useEngine";
import { uciMoveParams } from "@/lib/chess";
import Board from "@/components/board";
import { useGameData } from "@/hooks/useGameData";
import { usePlayersData } from "@/hooks/usePlayersData";
import { sleep } from "@/lib/helpers";
import { Chess } from "chess.js";

export default function BoardContainer({
  boardSize: propBoardSize,
  openingName,
}: {
  boardSize?: number;
  openingName?: string;
}) {
  const screenSize = useScreenSize();
  const engineName = useAtomValue(enginePlayNameAtom);
  const engine = useEngine(engineName);
  const game = useAtomValue(gameAtom);
  const { white, black } = usePlayersData(gameAtom);
  const playerColor = useAtomValue(playerColorAtom);
  const { playMove } = useChessActions(gameAtom);
  const engineElo = useAtomValue(engineEloAtom);
  const isGameInProgress = useAtomValue(isGameInProgressAtom);
  const [hintArrow, setHintArrow] = useAtom(hintArrowAtom);
  const historyIndex = useAtomValue(historyIndexAtom);

  const gameFen = game.fen();
  const isGameFinished = game.isGameOver();

  useEffect(() => {
    setHintArrow(null);
  }, [gameFen, setHintArrow]);

  useEffect(() => {
    const playEngineMove = async () => {
      if (
        !engine?.getIsReady() ||
        game.turn() === playerColor ||
        isGameFinished ||
        !isGameInProgress
      ) {
        return;
      }

      const timePromise = sleep(1000);
      const move = await engine.getEngineNextMove(gameFen, engineElo);
      await timePromise;

      if (move) playMove(uciMoveParams(move));
    };
    playEngineMove();

    return () => {
      engine?.stopAllCurrentJobs();
    };
  }, [gameFen, isGameInProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  const boardSize = useMemo(() => {
    if (propBoardSize !== undefined) return propBoardSize;

    const width = screenSize.width;
    const height = screenSize.height;

    // 900 is the md layout breakpoint
    if (window?.innerWidth < 900) {
      return Math.min(width, height - 150);
    }

    return Math.min(width - 300, height * 0.83);
  }, [screenSize, propBoardSize]);

  const displayFen = useMemo(() => {
    if (historyIndex === -1) return gameFen;
    const history = game.history({ verbose: true });
    if (historyIndex >= history.length) return gameFen;

    const tempChess = new Chess();
    for (let i = 0; i <= historyIndex; i++) {
      tempChess.move(history[i]);
    }
    return tempChess.fen();
  }, [game, gameFen, historyIndex]);

  const displayCanPlay = historyIndex === -1 ? (isGameInProgress ? playerColor : false) : false;

  useGameData(gameAtom, gameDataAtom);

  return (
    <Board
      id="PlayBoard"
      canPlay={displayCanPlay}
      gameAtom={gameAtom}
      boardSize={boardSize}
      whitePlayer={white}
      blackPlayer={black}
      boardOrientation={playerColor}
      currentPositionAtom={gameDataAtom}
      hintArrow={hintArrow}
      positionFen={displayFen}
      openingName={openingName}
    />
  );
}
