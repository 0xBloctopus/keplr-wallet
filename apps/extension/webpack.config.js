/* eslint-disable @typescript-eslint/no-var-requires */
const webpack = require("webpack");
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const ForkTsCheckerWebpackPlugin = require("fork-ts-checker-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const BundleAnalyzerPlugin =
  require("webpack-bundle-analyzer").BundleAnalyzerPlugin;
const fs = require("fs");
const testWalletConfigPath = path.resolve(
  __dirname,
  "test-wallet.config.json"
);

const loadTestWalletConfig = () => {
  if (!fs.existsSync(testWalletConfigPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(testWalletConfigPath, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(
      `Failed to parse test wallet config at ${testWalletConfigPath}:`,
      e
    );
    return {};
  }
};

const testWalletConfig = loadTestWalletConfig();
const bip44FromConfig = testWalletConfig.bip44 ?? {};

const testWalletEnvDefaults = {
  KEPLR_TEST_MNEMONIC: testWalletConfig.mnemonic ?? "",
  KEPLR_TEST_PASSWORD: testWalletConfig.password ?? "",
  KEPLR_TEST_ACCOUNT_NAME: testWalletConfig.accountName ?? "Test Wallet",
  KEPLR_TEST_BIP44_ACCOUNT: String(bip44FromConfig.account ?? 0),
  KEPLR_TEST_BIP44_CHANGE: String(bip44FromConfig.change ?? 0),
  KEPLR_TEST_BIP44_ADDRESS_INDEX: String(
    bip44FromConfig.addressIndex ?? 0
  ),
};

const isBuildManifestV2 = process.env.BUILD_MANIFEST_V2 === "true";

const isEnvDevelopment = process.env.NODE_ENV !== "production";
const isDisableSplitChunks = process.env.DISABLE_SPLIT_CHUNKS === "true";
const isEnvAnalyzer = process.env.ANALYZER === "true";
const commonResolve = (dir) => ({
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  alias: {
    assets: path.resolve(__dirname, dir),
  },
});
const altResolve = () => {
  const p = path.resolve(__dirname, "./src/keplr-wallet-private/index.ts");

  if (fs.existsSync(p)) {
    return {
      alias: {
        "keplr-wallet-private": path.resolve(
          __dirname,
          "./src/keplr-wallet-private/index.ts"
        ),
      },
    };
  }

  return {};
};
const tsRule = { test: /\.tsx?$/, loader: "ts-loader" };
const fileRule = {
  test: /\.(svg|png|webm|mp4|jpe?g|gif|woff|woff2|eot|ttf)$/i,
  type: "asset/resource",
  generator: {
    filename: "assets/[name][ext]",
  },
};

const keplrLogoBase64 = `data:image/png;base64,${fs.readFileSync(
  "src/public/assets/icon/icon-128.png",
  "base64"
)}`;

module.exports = {
  name: "extension",
  mode: isEnvDevelopment ? "development" : "production",
  // In development environment, turn on source map.
  devtool: isEnvDevelopment ? "cheap-source-map" : false,
  // In development environment, webpack watch the file changes, and recompile
  watch: isEnvDevelopment,
  entry: {
    popup: ["./src/index.tsx"],
    register: ["./src/register.tsx"],
    blocklist: ["./src/pages/blocklist/index.tsx"],
    ledgerGrant: ["./src/ledger-grant.tsx"],
    background: ["./src/background/background.ts"],
    contentScripts: ["./src/content-scripts/content-scripts.ts"],
    injectedScript: ["./src/content-scripts/inject/injected-script.ts"],
  },
  output: {
    path: path.resolve(
      __dirname,
      isEnvDevelopment ? "dist" : process.env.BUILD_OUTPUT || "build/default"
    ),
    filename: "[name].bundle.js",
  },
  optimization: {
    splitChunks: {
      chunks(chunk) {
        if (isDisableSplitChunks) {
          return false;
        }

        const servicePackages = ["contentScripts", "injectedScript"];

        if (!isBuildManifestV2) {
          servicePackages.push("background");
        }

        return !servicePackages.includes(chunk.name);
      },
      cacheGroups: {
        ...(() => {
          const res = {
            popup: {
              maxSize: 3_000_000,
              maxInitialRequests: 100,
              maxAsyncRequests: 100,
            },
            register: {
              maxSize: 3_000_000,
              maxInitialRequests: 100,
              maxAsyncRequests: 100,
            },
            blocklist: {
              maxSize: 3_000_000,
              maxInitialRequests: 100,
              maxAsyncRequests: 100,
            },
            ledgerGrant: {
              maxSize: 3_000_000,
              maxInitialRequests: 100,
              maxAsyncRequests: 100,
            },
          };

          if (isBuildManifestV2) {
            res.background = {
              maxSize: 3_000_000,
              maxInitialRequests: 100,
              maxAsyncRequests: 100,
            };
          }

          return res;
        })(),
      },
    },
  },
  resolve: {
    ...commonResolve("src/public/assets"),
    ...altResolve(),
    fallback: {
      os: require.resolve("os-browserify/browser"),
      buffer: require.resolve("buffer/"),
      http: require.resolve("stream-http"),
      https: require.resolve("https-browserify"),
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      process: require.resolve("process/browser"),
      zlib: require.resolve("browserify-zlib"),
    },
  },
  module: {
    rules: [
      tsRule,
      fileRule,
      {
        test: /\.m?js/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: "process/browser",
      Buffer: ["buffer", "Buffer"],
    }),
    new webpack.EnvironmentPlugin({
      NODE_ENV: isEnvDevelopment ? "development" : "production",
      // XXX: SC_DISABLE_SPEEDY is used for force enabling speedy mode for styled-components.
      //      According to the document, styled-components injects stylings to <style /> tag for each class name if development mode.
      //      However, on production mode, it injects stylings by using CSSOM.
      //      Probably, if development mode, this difference makes the blinking styling for transition components which changes the styling by JS code.
      //      At present, rather than fixing this for development mode, We fix this by forcing cssom to be enabled, and will fix this later when we have time.
      SC_DISABLE_SPEEDY: false,
      KEPLR_EXT_ETHEREUM_ENDPOINT: "",
      KEPLR_EXT_ANALYTICS_API_AUTH_TOKEN: "",
      KEPLR_EXT_ANALYTICS_API_URL: "",
      KEPLR_EXT_COINGECKO_ENDPOINT: "",
      KEPLR_EXT_COINGECKO_GETPRICE: "",
      KEPLR_EXT_COINGECKO_COIN_DATA_BY_TOKEN_ADDRESS: "",
      KEPLR_EXT_TRANSAK_API_KEY: "",
      KEPLR_EXT_MOONPAY_API_KEY: "",
      KEPLR_EXT_SWAPPED_API_KEY: "",
      KEPLR_EXT_SWAPPED_API_SECRET: "",
      KEPLR_EXT_CHAIN_REGISTRY_URL:
        "https://7v6zjsr36fqrqcaeuqbhyrq46a0qndzt.lambda-url.us-west-2.on.aws/{category}/{chain_identifier}.json",
      KEPLR_EXT_GOOGLE_MEASUREMENT_ID: "",
      KEPLR_EXT_GOOGLE_API_KEY_FOR_MEASUREMENT: "",
      KEPLR_EXT_AMPLITUDE_API_KEY: "",
      KEPLR_EXT_TOKEN_FACTORY_BASE_URL: "",
      KEPLR_EXT_TOKEN_FACTORY_URI: "",
      KEPLR_EXT_TX_HISTORY_BASE_URL: "",
      KEPLR_EXT_TX_HISTORY_TEST_BASE_URL: "https://satellite-develop.keplr.app",
      KEPLR_EXT_CONFIG_SERVER:
        "https://gjsttg7mkgtqhjpt3mv5aeuszi0zblbb.lambda-url.us-west-2.on.aws",
      WC_PROJECT_ID: "",
      KEPLR_EXT_EIP6963_PROVIDER_INFO_NAME: "Keplr",
      KEPLR_EXT_EIP6963_PROVIDER_INFO_RDNS: "app.keplr",
      KEPLR_EXT_EIP6963_PROVIDER_INFO_ICON: keplrLogoBase64,
      KEPLR_EXT_STARKNET_PROVIDER_INFO_ID: "keplr",
      KEPLR_EXT_STARKNET_PROVIDER_INFO_NAME: "Keplr",
      KEPLR_EXT_STARKNET_PROVIDER_INFO_ICON: keplrLogoBase64,
      SKIP_API_KEY: "",
      KEPLR_EXT_PROVIDER_META_ID: "",
      KEPLR_EXT_MOONPAY_SIGN_API_BASE_URL: "",
      KEPLR_API_ENDPOINT: "",
      KEPLR_EXT_TX_CODEC_BASE_URL: "",
      KEPLR_EXT_TOPUP_BASE_URL: "",
      KEPLR_EXT_TOPUP_API_KEY: "",
      ...testWalletEnvDefaults,
    }),
    new ForkTsCheckerWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        ...(() => {
          if (isBuildManifestV2) {
            return [
              {
                from: "./src/manifest.v2.json",
                to: "./manifest.json",
              },
            ];
          }

          return [
            {
              from: "./src/manifest.v3.json",
              to: "./manifest.json",
            },
          ];
        })(),
        {
          from: "../../node_modules/webextension-polyfill/dist/browser-polyfill.js",
          to: "./",
        },
      ],
    }),
    // popup.html과 sidePanel.html은 사실 동일하다.
    // 단지 popup에서 실행되었는지 sidePanel에서 실행되었는지를
    // js에서 파일 이름으로 알아내기 위해서 분리했다.
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      filename: "popup.html",
      chunks: ["popup"],
    }),
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      filename: "sidePanel.html",
      chunks: ["popup"],
    }),
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      filename: "register.html",
      chunks: ["register"],
    }),
    new HtmlWebpackPlugin({
      template: "./src/blocklist.html",
      filename: "blocklist.html",
      chunks: ["blocklist"],
    }),
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      filename: "ledger-grant.html",
      chunks: ["ledgerGrant"],
    }),
    new HtmlWebpackPlugin({
      template: "./src/keplr-earn-product-terms.html",
      filename: "keplr-earn-product-terms.html",
      chunks: ["keplrEarnProductTerms"],
    }),
    ...(() => {
      if (isBuildManifestV2) {
        return [
          new HtmlWebpackPlugin({
            template: "./src/background.html",
            filename: "background.html",
            chunks: ["background"],
          }),
        ];
      }

      return [];
    })(),
    new BundleAnalyzerPlugin({
      analyzerMode: isEnvAnalyzer ? "server" : "disabled",
    }),
  ],
};
