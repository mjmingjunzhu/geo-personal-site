/** @type {import('tailwindcss').Config} */
module.exports = {
  // 精确指定承载 Tailwind class 的源文件：
  // 本项目所有 Tailwind class 都写在 src/build.js 的模板字符串中。
  // src/data.js 是纯内容数据（中文文本），不含 class，无需扫描。
  content: ["./src/build.js"],

  theme: {
    extend: {
      colors: {
        gray: {
          50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4',
          400: '#a3a3a3', 500: '#737373', 600: '#525252', 700: '#404040',
          800: '#262626', 900: '#171717'
        }
      }
    }
  },
  plugins: [],
}