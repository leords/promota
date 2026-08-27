import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { pdvsRouter } from './routes/pdvs.js';
import { productsRouter } from './routes/products.js';
import { routesRouter } from './routes/routes.js';
import { visitsRouter } from './routes/visits.js';
import { priceCollectionsRouter } from './routes/priceCollections.js';
import { photosRouter } from './routes/photos.js';
import { usersRouter } from './routes/users.js';
import { occurrencesRouter } from './routes/occurrences.js';
import { dashboardRouter } from './routes/dashboard.js';
import { expirationsRouter } from './routes/expirations.js';
import { surveysRouter } from './routes/surveys.js';
import { eventsRouter } from './routes/events.js';
import { reportsRouter } from './routes/reports.js';
import { notificationsRouter } from './routes/notifications.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(healthRouter);
app.use(authRouter);
app.use(meRouter);
app.use(pdvsRouter);
app.use(productsRouter);
app.use(routesRouter);
app.use(visitsRouter);
app.use(priceCollectionsRouter);
app.use(photosRouter);
app.use(usersRouter);
app.use(occurrencesRouter);
app.use(dashboardRouter);
app.use(expirationsRouter);
app.use(surveysRouter);
app.use(eventsRouter);
app.use(reportsRouter);
app.use(notificationsRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
};
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`API listening on http://localhost:${env.port}`);
});
