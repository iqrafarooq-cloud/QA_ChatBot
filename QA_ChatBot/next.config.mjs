/** @type {import('next').NextConfig} */
const nextConfig = {
  // Parsers run only on the server and load fine from node_modules at runtime.
  serverExternalPackages: ["unpdf", "mammoth", "xlsx"],
  // The floating dev badge overlaps the chat composer on small screens.
  devIndicators: false,
};

export default nextConfig;
