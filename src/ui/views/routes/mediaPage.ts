import { MediaLibrary } from '../../media/MediaLibrary';
import type { RouteDefinition } from './RouteRegistry';

/**
 * Every image the world uses, with where each is used — as saved views (wall, cards, table)
 * with filters, sorting and grouping. Also the place to repair images that were moved or
 * deleted while Worldsmith wasn't watching.
 */
export const mediaRoute: RouteDefinition = {
	id: 'media',
	needsWorld: true,
	title: () => 'Media',
	icon: () => 'images',
	render(ctx) {
		new MediaLibrary(ctx, ctx.session!).mount(ctx.el);
	},
};
