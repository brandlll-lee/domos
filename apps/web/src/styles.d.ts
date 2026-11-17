declare module "*.css";
declare module "*.css?inline" {
  const css: string;
  export default css;
}
declare module "*?url" {
  const url: string;
  export default url;
}
