/* PSE · 全局类型声明（TS 迁移的脚手架）
 * 游戏代码以经典 <script> IIFE 形式加载，全部挂在 globalThis.PSE 命名空间上。
 * 本文件让 TS 认识这些全局；各模块内部仍用自己的 const PSE 局部变量（合法遮蔽）。
 * 后续可在此逐步补全世界状态的具体接口（World / Country / Province / Division…），
 * 把 AUS/AUT 这类字符串 tag 写错、字段漏初始化的问题全部变成编译期错误。
 */
interface Window {
  PSE: any;
}

declare var PSE: any;
