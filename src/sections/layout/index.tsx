import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { PropsWithChildren, useMemo } from "react";
import NavBar from "./NavBar";
import { red } from "@mui/material/colors";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { MAIN_THEME_COLOR } from "@/constants";
import { useRouter } from "next/router";

export default function Layout({ children }: PropsWithChildren) {
  const [isDarkMode, setDarkMode] = useLocalStorage("useDarkMode", true);
  const router = useRouter();

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: isDarkMode ? "dark" : "light",
          error: {
            main: red[400],
          },
          primary: {
            main: MAIN_THEME_COLOR,
          },
          secondary: {
            main: isDarkMode ? "#424242" : "#ffffff",
          },
        },
      }),
    [isDarkMode]
  );

  if (isDarkMode === null) return null;

  const isPlayPage =
    router.pathname === "/play" ||
    router.pathname === "/" ||
    router.pathname === "/analysis";

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {!isPlayPage && (
        <NavBar
          darkMode={isDarkMode}
          switchDarkMode={() => setDarkMode((val) => !val)}
        />
      )}
      <main
        style={
          isPlayPage
            ? {
                margin: 0,
                padding: 0,
                height: "100dvh",
                width: "100vw",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }
            : { margin: "2vh 1vw" }
        }
      >
        {children}
      </main>
    </ThemeProvider>
  );
}

