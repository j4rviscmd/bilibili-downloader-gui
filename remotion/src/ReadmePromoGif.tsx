import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import React from 'react';

interface ReadmePromoGifProps {
	appName: string;
	description: string;
}

// 星のパーティクルコンポーネント
const StarParticle: React.FC<{
	delay: number;
	x: number;
	y: number;
	angle: number;
}> = ({delay, x, y, angle}) => {
	const frame = useCurrentFrame();
	const effectiveFrame = frame - delay;

	if (effectiveFrame < 0) return null;

	// パーティクルのアニメーション
	const opacity = interpolate(effectiveFrame, [0, 20], [1, 0], {
		extrapolateRight: 'clamp',
	});
	const distance = interpolate(effectiveFrame, [0, 30], [0, 60], {
		extrapolateRight: 'clamp',
	});
	const scale = interpolate(effectiveFrame, [0, 10, 30], [0.5, 1, 0.3], {
		extrapolateRight: 'clamp',
	});

	const radian = (angle * Math.PI) / 180;
	const particleX = x + Math.cos(radian) * distance;
	const particleY = y + Math.sin(radian) * distance;

	return (
		<div
			style={{
				position: 'absolute',
				left: particleX,
				top: particleY,
				opacity,
				transform: `scale(${scale})`,
			}}
		>
			<svg width={16} height={16} viewBox="0 0 16 16" fill="#e3b341">
				<path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" />
			</svg>
		</div>
	);
};

export const ReadmePromoGif: React.FC<ReadmePromoGifProps> = () => {
	const frame = useCurrentFrame();

	// マウスカーソルの移動 (30-60フレーム)
	const mouseX = interpolate(frame, [30, 60], [240, 300], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});
	const mouseY = interpolate(frame, [30, 60], [35, 25], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});

	// ホバーエフェクト - マウスが近づくとボタンが明るくなる
	const hoverProgress = interpolate(frame, [50, 60], [0, 1], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});
	const buttonBrightness = 1 + hoverProgress * 0.1;
	const borderColor = interpolate(frame, [50, 60], [48, 99], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});
	const borderColorStr = `rgb(${borderColor}, ${borderColor + 20}, ${borderColor + 40})`;

	// クリックエフェクト (60-70フレーム)
	const clickScale = interpolate(frame, [60, 65, 70], [1, 0.92, 1], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});

	// 輝きエフェクト (70-100フレーム)
	const glowOpacity = interpolate(frame, [70, 80, 100], [0, 1, 0], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});
	const glowScale = interpolate(frame, [70, 100], [1, 1.3], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});

	// Starの色変化 (70フレーム以降)
	const starColor = interpolate(frame, [70, 90], [0, 1], {
		extrapolateRight: 'clamp',
		extrapolateLeft: 'clamp',
	});
	const starFill = `rgba(255, 255, 255, ${starColor})`;
	const starStroke = starColor > 0.5 ? '#e3b341' : '#8b949e';

	return (
		<AbsoluteFill style={{backgroundColor: '#0d1117', fontFamily: 'Arial, sans-serif'}}>
			{/* 輝きエフェクト（クリック後の後光） */}
			{frame >= 70 && frame <= 100 && (
				<div
					style={{
						position: 'absolute',
						top: '50%',
						left: '50%',
						width: 200,
						height: 80,
						background: `radial-gradient(circle, rgba(227, 179, 65, ${glowOpacity * 0.3}) 0%, transparent 70%)`,
						transform: `translate(-50%, -50%) scale(${glowScale})`,
						borderRadius: '50%',
					}}
				/>
			)}

			{/* Star Button - 中心に配置 */}
			<div
				style={{
					position: 'absolute',
					top: '50%',
					left: '50%',
					transform: 'translate(-50%, -50%)',
				}}
			>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						padding: '2px 8px',
						backgroundColor: `rgba(33, 38, 45, ${buttonBrightness})`,
						border: `1px solid ${borderColorStr}`,
						borderRadius: 6,
						color: '#c9d1d9',
						fontSize: 24,
						fontWeight: 600,
						transform: frame >= 60 && frame <= 70 ? `scale(${clickScale})` : 'scale(1)',
						boxShadow: hoverProgress > 0.5 ? `0 0 ${hoverProgress * 10}px rgba(227, 179, 65, ${hoverProgress * 0.3})` : 'none',
					}}
				>
					<svg
						width={26}
						height={26}
						viewBox="0 0 16 16"
						fill={starFill}
						stroke={starStroke}
						strokeWidth={1}
					>
						<path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" />
					</svg>
					<span>Star</span>
				</div>
			</div>

			{/* 星のパーティクル */}
			<StarParticle delay={65} x={300} y={25} angle={-45} />
			<StarParticle delay={67} x={300} y={25} angle={0} />
			<StarParticle delay={69} x={300} y={25} angle={45} />

			{/* Mouse Cursor */}
			{frame >= 30 && frame <= 70 && (
				<div
					style={{
						position: 'absolute',
						left: mouseX,
						top: mouseY,
						transform: 'translate(-4, -4)',
					}}
				>
					<svg width={28} height={28} viewBox="0 0 24 24" fill="white">
						<path d="M5.5 3.21l12.6 12.6-3.5 1.3-3.3 6.5-1.8-5.9-5.9-1.8 6.5-3.3 1.3-3.5z" />
					</svg>
				</div>
			)}
		</AbsoluteFill>
	);
};
