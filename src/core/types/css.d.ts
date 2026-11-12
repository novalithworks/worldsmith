/** Stylesheets imported as text (native-note styling, written into notes' CSS snippet). */
declare module '*.css' {
	const text: string;
	export default text;
}
