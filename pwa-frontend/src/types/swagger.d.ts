declare module "swagger-ui-react" {
	import type { ComponentType } from "react";
	interface SwaggerProps {
		spec?: any;
		[key: string]: any;
	}
	const SwaggerUI: ComponentType<SwaggerProps>;
	export default SwaggerUI;
}
