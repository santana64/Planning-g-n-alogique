'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  AttributionControl,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { AtlasArc, AtlasPoint } from '@/server/atlas';
import { FLOW_DASHES, arcsToGeoJson, buildStyle, pointsToGeoJson } from './atlas-style';

/**
 * The map.
 *
 * No tile provider: the basemap is a public-domain outline shipped with the
 * application, and every other layer is computed on the server. That removes
 * an API key a self-hosted instance would otherwise need, and it removes a
 * temptation — street-level tiles under an 1830 baptism invite the reader to
 * believe a precision the parish register never recorded.
 *
 * Place labels are HTML markers rather than a symbol layer. A symbol layer
 * needs a glyph endpoint, which is another external dependency, and markers
 * come out in the application's own typography instead of a renderer's
 * default.
 */

interface AtlasMapProps {
  readonly points: readonly AtlasPoint[];
  readonly arcs: readonly AtlasArc[];
  readonly cursorJdn: number | null;
  readonly onSelect: (placeId: string | null) => void;
  readonly selectedPlaceId: string | null;
}

const FLOW_STEP_MS = 90;

// The worker that parses the GeoJSON layers, served from this origin: left to
// itself, MapLibre would ask the page for it once bundled, and draw nothing.
// Copied there at build time by scripts/copy-maplibre-worker.mjs.
setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function AtlasMap({ points, arcs, cursorJdn, onSelect, selectedPlaceId }: AtlasMapProps) {
  const t = useTranslations('atlas');
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const readyRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = new MapLibreMap({
      container,
      style: buildStyle(),
      center: [-20, 20],
      zoom: 1.6,
      attributionControl: false,
      // The map is a reading instrument, not a globe to spin. Rotation makes
      // a north-up mental model harder for no gain here.
      dragRotate: false,
      pitchWithRotate: false,
    });

    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new AttributionControl({
        compact: true,
        // Natural Earth is public domain and asks for no attribution. Saying
        // where the outline came from is a courtesy to the next reader, and
        // the honest answer to "is this map live data".
        customAttribution: 'Fond de carte : Natural Earth (domaine public)',
      }),
      'bottom-right',
    );

    let flow = 0;
    let flowTimer: ReturnType<typeof setInterval> | null = null;
    map.on('load', () => {
      readyRef.current = true;
      map.resize();
      if (prefersReducedMotion()) return;
      flowTimer = setInterval(() => {
        // A hidden tab keeps its timers, at a crawl; skipping the frame costs
        // nothing and keeps the GPU idle.
        if (document.hidden) return;
        flow = (flow + 1) % FLOW_DASHES.length;
        map.setPaintProperty('arcs-flow', 'line-dasharray', FLOW_DASHES[flow]);
      }, FLOW_STEP_MS);
    });

    mapRef.current = map;

    // Captured at setup, not read at teardown. The Map object is only ever
    // mutated, never reassigned, so this is the same collection the other
    // effect fills — and it is what the exhaustive-deps rule is asking for.
    const markers = markersRef.current;

    return () => {
      if (flowTimer) clearInterval(flowTimer);
      readyRef.current = false;
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Arcs follow the cursor.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      const source = map.getSource('arcs');
      // The style spec's own types are structural; the computed collection is
      // built to match and asserted once here rather than at every call site.
      if (source instanceof GeoJSONSource) {
        source.setData(arcsToGeoJson(arcs, cursorJdn) as never);
      }
    };

    if (readyRef.current) apply();
    else map.once('load', apply);
  }, [arcs, cursorJdn]);

  // A place chosen — on the map or in the list below — is travelled to, so
  // the reader keeps their bearings; under reduced motion it is jumped to.
  useEffect(() => {
    const map = mapRef.current;
    const place = points.find((point) => point.placeId === selectedPlaceId);
    if (!map || !place) return;
    const target = {
      center: [place.longitude, place.latitude] as [number, number],
      zoom: Math.max(map.getZoom(), 4.2),
    };
    if (prefersReducedMotion()) map.jumpTo(target);
    else map.flyTo({ ...target, speed: 0.9, curve: 1.5, essential: false });
  }, [points, selectedPlaceId]);

  // Places are markers, reconciled rather than rebuilt: recreating every
  // marker on each cursor tick makes dragging the slider flicker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visible = pointsToGeoJson(points, cursorJdn);
    const wanted = new Set(visible.features.map((f) => String(f.properties['placeId'])));

    for (const [placeId, marker] of markersRef.current) {
      if (!wanted.has(placeId)) {
        marker.remove();
        markersRef.current.delete(placeId);
      }
    }

    const maxEvents = Math.max(1, ...points.map((point) => point.eventCount));

    for (const feature of visible.features) {
      const placeId = String(feature.properties['placeId']);
      const name = String(feature.properties['name']);
      const eventCount = Number(feature.properties['eventCount']);
      const coordinates = feature.geometry.coordinates as [number, number];

      // Area proportional to the count, so twice the records reads as twice
      // the ink rather than twice the radius — which would look like four.
      const size = 10 + 22 * Math.sqrt(eventCount / maxEvents);
      const existing = markersRef.current.get(placeId);

      if (existing) {
        const element = existing.getElement();
        element.dataset['selected'] = String(placeId === selectedPlaceId);
        continue;
      }

      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'atlas-marker';
      element.style.width = `${size}px`;
      element.style.height = `${size}px`;
      element.dataset['selected'] = String(placeId === selectedPlaceId);
      const label = t('marker', { name, events: eventCount });
      element.setAttribute('aria-label', label);
      element.title = label;
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelect(placeId);
      });

      const marker = new Marker({ element }).setLngLat(coordinates).addTo(map);
      markersRef.current.set(placeId, marker);
    }
  }, [points, cursorJdn, selectedPlaceId, onSelect, t]);

  return (
    <div
      ref={containerRef}
      // Not `role="application"`: there is nothing here a keyboard user can
      // do that the table below does not do better, and claiming otherwise
      // would send a screen reader into a canvas it cannot read.
      aria-hidden="true"
      className="bg-surface-sunken h-full w-full"
    />
  );
}
