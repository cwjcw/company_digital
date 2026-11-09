module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  moduleNameMapper: {
    "^@kdos/contracts$": "<rootDir>/../../../packages/contracts/src/index.ts",
    "^@tracker/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
    "^@kdos/contracts$": "<rootDir>/../../../packages/contracts/src/index.ts",
    "^@kdos/permissions$": "<rootDir>/../../../packages/permissions/src/index.ts"
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node"
};
