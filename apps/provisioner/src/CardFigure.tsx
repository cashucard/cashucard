/**
 * The card figure: the physical card's own printed art (FL1, from
 * lnflash/flash-card-assets, MIT) as the face, dimmed while unwritten and
 * revealed left-to-right as the load's blocks land — the write sweep is the
 * run's real block count, never an animation. Stop states ring it; done
 * wears the accent.
 */
import React from 'react';
import {Image, ImageSourcePropType, StyleSheet, View} from 'react-native';

import {useTheme, type Theme} from './theme';

const W = 220;
/** The art's own ratio after its print-margin trim (1048×663) — the ring hugs the card. */
const H = 220 / 1.5807;

/** FL1: the Flash bearer front (black, bolt roundel, gold chip). */
const FL1_FRONT: ImageSourcePropType = require('../assets/cardart/fl1-front.png');

export function CardFigure({
  fill,
  state,
}: {
  /** 0..1 of the load written; 1 = done. */
  fill: number;
  state: 'idle' | 'running' | 'done' | 'stop' | 'danger';
}) {
  const t = useTheme();
  const s = styles(t);
  const dim = fill < 1 ? 0.28 : 1;
  const border =
    state === 'danger'
      ? s.ringDanger
      : state === 'done'
        ? s.ringDone
        : state === 'stop'
          ? s.ringStop
          : s.ringIdle;
  return (
    <View style={[s.box, border]}>
      {/* the unwritten card: the art at a ghost opacity */}
      <Image
        source={FL1_FRONT}
        style={[s.art, {opacity: dim}]}
        resizeMode="cover"
      />
      {/* the written sweep: the same art at full ink, clipped to the load */}
      {fill > 0 && fill < 1 ? (
        <View style={[s.sweep, {width: W * fill}]}>
          <Image source={FL1_FRONT} style={s.art} resizeMode="cover" />
        </View>
      ) : null}
    </View>
  );
}

const styles = (t: Theme) =>
  StyleSheet.create({
    box: {
      width: W,
      height: H,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 2,
      backgroundColor: t.card,
    },
    art: {position: 'absolute', width: W, height: H},
    sweep: {position: 'absolute', left: 0, top: 0, height: H, overflow: 'hidden'},
    ringIdle: {borderColor: t.dim},
    ringStop: {borderColor: t.dim},
    ringDanger: {borderColor: t.danger},
    ringDone: {borderColor: t.accent},
  });
