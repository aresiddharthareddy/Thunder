import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { availableParallelism } from "node:os";

// This revision is the source bundled with the pinned node-llama-cpp dependency.
const revision = "eaced9a156dcfc8133231a0a292cda094b9fdc78";

export async function prepareCpuRuntime(root, destination) {
  const cache = path.join(root, ".thunder-build", "cpu-runtime", process.arch, revision);
  const source = path.join(cache, "llama.cpp");
  const build = path.join(cache, "build");
  const binary = path.join(build, "bin", "llama-completion");
  const bundle = path.join(root, "node_modules", "node-llama-cpp", "llama", "gitRelease.bundle");
  const readHead = () => execFileSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!await fs.stat(path.join(source, ".git")).catch(() => null)) {
    await fs.mkdir(cache, { recursive: true });
    execFileSync("git", ["clone", "--quiet", "--no-checkout", bundle, source]);
    execFileSync("git", ["-C", source, "checkout", "--quiet", "--detach", revision]);
  }
  if (readHead() !== revision) throw new Error("Unexpected llama.cpp source revision for the CPU runtime.");
  if (!await fs.stat(binary).catch(() => null)) {
    const cmake = process.env.THUNDER_CMAKE ?? "cmake";
    try {
      execFileSync(cmake, ["--version"], { stdio: "ignore" });
    } catch {
      throw new Error("Install CMake on the build host or set THUNDER_CMAKE to its executable to build the bundled CPU runtime.");
    }
    execFileSync(cmake, [
      "-S", source, "-B", build, "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0",
      "-DBUILD_SHARED_LIBS=OFF", "-DGGML_METAL=OFF", "-DGGML_NATIVE=OFF", "-DGGML_OPENMP=OFF", "-DGGML_CCACHE=OFF",
      "-DLLAMA_OPENSSL=OFF", "-DLLAMA_BUILD_TESTS=OFF", "-DLLAMA_BUILD_EXAMPLES=OFF", "-DLLAMA_BUILD_SERVER=OFF",
      "-DLLAMA_BUILD_APP=OFF", "-DLLAMA_BUILD_UI=OFF",
    ], { stdio: "inherit" });
    execFileSync(cmake, ["--build", build, "--target", "llama-completion", "--parallel", String(Math.min(8, availableParallelism()))], { stdio: "inherit" });
  }
  const dependencies = execFileSync("otool", ["-L", binary], { encoding: "utf8" }).split("\n").slice(1).map(line => line.trim()).filter(Boolean);
  if (dependencies.some(line => !/^\/(usr\/lib|System\/Library)\//.test(line))) {
    throw new Error("The CPU runtime depends on a library outside macOS.");
  }
  const architectures = execFileSync("lipo", ["-archs", binary], { encoding: "utf8" }).trim().split(/\s+/);
  if (!architectures.includes(process.arch === "arm64" ? "arm64" : "x86_64")) throw new Error("The CPU runtime has the wrong architecture.");
  await fs.mkdir(destination, { recursive: true });
  await fs.copyFile(binary, path.join(destination, "llama-completion"));
  await fs.copyFile(path.join(source, "LICENSE"), path.join(destination, "LLAMA-LICENSE"));
}
