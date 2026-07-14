import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

// Register AG Grid modules once for the entire application
ModuleRegistry.registerModules([AllCommunityModule]);

export { ModuleRegistry, AllCommunityModule };
